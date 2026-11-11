import { beforeEach, describe, expect, it, vi } from "vitest";

const configKey = vi.fn();
const factories = vi.hoisted(() => ({ createSigner: vi.fn(), createVerifier: vi.fn() }));

vi.mock("@warlock.js/core", () => ({
  config: { key: (...args: unknown[]) => configKey(...args) },
}));

vi.mock("@warlock.js/logger", () => ({
  log: { warn: vi.fn() },
}));

vi.mock("fast-jwt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fast-jwt")>();

  factories.createSigner.mockImplementation(actual.createSigner);
  factories.createVerifier.mockImplementation(actual.createVerifier);

  return {
    ...actual,
    createSigner: (...args: Parameters<typeof actual.createSigner>) =>
      factories.createSigner(...args),
    createVerifier: (...args: Parameters<typeof actual.createVerifier>) =>
      factories.createVerifier(...args),
  };
});

import { createSigner } from "fast-jwt";
import { isInvalidCredentialError, jwt } from "./jwt";

const SECRET = "access-secret-key-for-tests-0123456789-abcdef";
const ONE_HOUR = 3_600_000;

function stubConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    "auth.accessToken.secret": SECRET,
    ...overrides,
  };

  configKey.mockImplementation((key: string, fallback?: unknown) =>
    key in values ? values[key] : fallback,
  );
}

beforeEach(() => {
  configKey.mockReset();
  factories.createSigner.mockClear();
  factories.createVerifier.mockClear();
  stubConfig();
});

describe("prepared verifiers and signers", () => {
  it("builds the access verifier once for repeated verifications with the same settings", async () => {
    const token = await jwt.generate({ id: 1 }, { expiresIn: ONE_HOUR });
    factories.createVerifier.mockClear();

    await jwt.verify(token);
    await jwt.verify(token);
    await jwt.verify(token);

    expect(factories.createVerifier).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the verifier when the secret changes, and the old token stops verifying", async () => {
    const token = await jwt.generate({ id: 1 }, { expiresIn: ONE_HOUR });
    await jwt.verify(token);

    stubConfig({ "auth.accessToken.secret": `${SECRET}-rotated` });

    const error = await jwt.verify(token).catch((caught: unknown) => caught);

    expect(isInvalidCredentialError(error)).toBe(true);
  });

  it("builds the signer once for repeated issues with the same lifetime", async () => {
    factories.createSigner.mockClear();

    await jwt.generate({ id: 1 }, { expiresIn: ONE_HOUR + 1 });
    await jwt.generate({ id: 2 }, { expiresIn: ONE_HOUR + 1 });

    expect(factories.createSigner).toHaveBeenCalledTimes(1);
  });

  it("builds a fresh verifier when the caller passes its own options", async () => {
    const token = await jwt.generate({ id: 1 }, { expiresIn: ONE_HOUR });
    await jwt.verify(token);
    factories.createVerifier.mockClear();

    await jwt.verify(token, { clockTolerance: 5 });

    expect(factories.createVerifier).toHaveBeenCalledTimes(1);
  });
});

describe("issuer and audience", () => {
  const scoped = {
    "auth.accessToken.issuer": "https://api.test",
    "auth.accessToken.audience": "web",
  };

  it("stamps the configured iss/aud on access and refresh tokens and accepts them back", async () => {
    stubConfig(scoped);

    const access = await jwt.generate({ id: 1 }, { expiresIn: ONE_HOUR });
    const refresh = await jwt.generateRefreshToken({ userId: 1 }, { expiresIn: ONE_HOUR });

    expect(await jwt.verify(access)).toMatchObject({ iss: "https://api.test", aud: "web" });
    expect(await jwt.verifyRefreshToken(refresh)).toMatchObject({ iss: "https://api.test" });
  });

  it("refuses a token from another issuer signed with the same secret", async () => {
    stubConfig(scoped);
    const foreign = createSigner({ key: SECRET, expiresIn: ONE_HOUR })({
      id: 1,
      iss: "https://other.test",
      aud: "web",
    });

    const error = await jwt.verify(foreign).catch((caught: unknown) => caught);

    expect(isInvalidCredentialError(error)).toBe(true);
  });

  it("refuses a token signed before the issuer was configured (no iss claim)", async () => {
    const legacy = await jwt.generate({ id: 1 }, { expiresIn: ONE_HOUR });
    stubConfig(scoped);

    const error = await jwt.verify(legacy).catch((caught: unknown) => caught);

    expect(isInvalidCredentialError(error)).toBe(true);
  });

  it("stamps and checks nothing when neither is configured", async () => {
    const token = await jwt.generate({ id: 1 }, { expiresIn: ONE_HOUR });
    const decoded = (await jwt.verify(token)) as Record<string, unknown>;

    expect(decoded.iss).toBeUndefined();
    expect(decoded.aud).toBeUndefined();
  });
});
