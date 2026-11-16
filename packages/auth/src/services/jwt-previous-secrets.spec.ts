import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSigner } from "fast-jwt";

const configKey = vi.fn();

vi.mock("@warlock.js/core", () => ({
  config: { key: (...args: unknown[]) => configKey(...args) },
}));

vi.mock("@warlock.js/logger", () => ({
  log: { warn: vi.fn() },
}));

import { jwt } from "./jwt";

const OLD_SECRET = "old-access-secret-for-tests-0123456789";
const NEW_SECRET = "new-access-secret-for-tests-0123456789";
const OLD_REFRESH = "old-refresh-secret-for-tests-0123456789";
const NEW_REFRESH = "new-refresh-secret-for-tests-0123456789";
const STRANGER = "stranger-secret-for-tests-0123456789ab";

function stubConfig(values: Record<string, unknown>) {
  const all: Record<string, unknown> = { "auth.accessToken.algorithm": "HS256", ...values };

  configKey.mockImplementation((key: string, fallback?: unknown) =>
    key in all ? all[key] : fallback,
  );
}

function signWith(secret: string, payload: Record<string, unknown>, expiresIn = 3_600_000) {
  return createSigner({ key: secret, expiresIn, algorithm: "HS256" })(payload) as string;
}

describe("jwt previous secrets", () => {
  beforeEach(() => {
    configKey.mockReset();
  });

  it("accepts an access token signed with a previous secret", async () => {
    stubConfig({
      "auth.accessToken.secret": NEW_SECRET,
      "auth.accessToken.previousSecrets": [OLD_SECRET],
    });

    const token = signWith(OLD_SECRET, { id: 1, tokenType: "access" });

    expect(await jwt.verify(token)).toMatchObject({ id: 1 });
  });

  it("signs new tokens with the current secret only", async () => {
    stubConfig({
      "auth.accessToken.secret": NEW_SECRET,
      "auth.accessToken.previousSecrets": [OLD_SECRET],
    });

    const token = await jwt.generate({ id: 2 }, { expiresIn: 3_600_000 });

    expect(await jwt.verify(token, { key: NEW_SECRET })).toMatchObject({ id: 2 });
    await expect(jwt.verify(token, { key: OLD_SECRET })).rejects.toMatchObject({
      code: "FAST_JWT_INVALID_SIGNATURE",
    });
  });

  it("rejects a token signed with a secret that is neither current nor previous", async () => {
    stubConfig({
      "auth.accessToken.secret": NEW_SECRET,
      "auth.accessToken.previousSecrets": [OLD_SECRET],
    });

    const token = signWith(STRANGER, { id: 1, tokenType: "access" });

    await expect(jwt.verify(token)).rejects.toMatchObject({ code: "FAST_JWT_INVALID_SIGNATURE" });
  });

  it("rejects an old-secret token when no previous secrets are configured", async () => {
    stubConfig({ "auth.accessToken.secret": NEW_SECRET });

    const token = signWith(OLD_SECRET, { id: 1, tokenType: "access" });

    await expect(jwt.verify(token)).rejects.toMatchObject({ code: "FAST_JWT_INVALID_SIGNATURE" });
  });

  it("still rejects an expired token signed with a previous secret", async () => {
    stubConfig({
      "auth.accessToken.secret": NEW_SECRET,
      "auth.accessToken.previousSecrets": [OLD_SECRET],
    });

    const token = createSigner({
      key: OLD_SECRET,
      expiresIn: 1000,
      algorithm: "HS256",
    })({ tokenType: "access", iat: Math.floor(Date.now() / 1000) - 3600 }) as string;

    await expect(jwt.verify(token)).rejects.toMatchObject({ code: "FAST_JWT_EXPIRED" });
  });

  it("ignores previous secrets when the caller passes an explicit key", async () => {
    stubConfig({
      "auth.accessToken.secret": NEW_SECRET,
      "auth.accessToken.previousSecrets": [OLD_SECRET],
    });

    const token = signWith(OLD_SECRET, { tokenType: "access" });

    await expect(jwt.verify(token, { key: NEW_SECRET })).rejects.toMatchObject({
      code: "FAST_JWT_INVALID_SIGNATURE",
    });
  });

  it("does not let an old access-secret token pass as a refresh token", async () => {
    stubConfig({
      "auth.accessToken.secret": NEW_SECRET,
      "auth.accessToken.previousSecrets": [OLD_SECRET],
      "auth.refreshToken.secret": NEW_REFRESH,
    });

    const token = signWith(OLD_SECRET, { tokenType: "refresh" });

    await expect(jwt.verifyRefreshToken(token)).rejects.toMatchObject({
      code: "FAST_JWT_INVALID_SIGNATURE",
    });
  });

  it("accepts a refresh token signed with a previous refresh secret", async () => {
    stubConfig({
      "auth.accessToken.secret": NEW_SECRET,
      "auth.refreshToken.secret": NEW_REFRESH,
      "auth.refreshToken.previousSecrets": [OLD_REFRESH],
    });

    const token = signWith(OLD_REFRESH, { id: 3, tokenType: "refresh" });

    expect(await jwt.verifyRefreshToken(token)).toMatchObject({ id: 3 });
  });

  it("rejects a refresh token signed with a stranger secret", async () => {
    stubConfig({
      "auth.accessToken.secret": NEW_SECRET,
      "auth.refreshToken.secret": NEW_REFRESH,
      "auth.refreshToken.previousSecrets": [OLD_REFRESH],
    });

    await expect(
      jwt.verifyRefreshToken(signWith(STRANGER, { tokenType: "refresh" })),
    ).rejects.toMatchObject({ code: "FAST_JWT_INVALID_SIGNATURE" });
  });

  it("uses the previous access secrets for refresh tokens when no refresh secret is set", async () => {
    stubConfig({
      "auth.accessToken.secret": NEW_SECRET,
      "auth.accessToken.previousSecrets": [OLD_SECRET],
    });

    const token = signWith(OLD_SECRET, { id: 4, tokenType: "refresh" });

    expect(await jwt.verifyRefreshToken(token)).toMatchObject({ id: 4 });
  });
});
