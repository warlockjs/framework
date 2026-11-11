import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { authTokensCheck, parseDurationMs } from "./auth-tokens.check";

const bootContext = {} as DoctorBootContext;

const STRONG = "x".repeat(48);

async function run() {
  return await authTokensCheck.run(bootContext);
}

afterEach(() => {
  vi.restoreAllMocks();
  setConfig("auth", undefined as unknown as never);
});

describe("doctor auth-tokens check", () => {
  it("is ok for a strong secret, 1-hour access tokens and refresh tokens on", async () => {
    setConfig("auth", {
      userType: { user: class {} },
      accessToken: { secret: STRONG, expiresIn: "1h" },
      refreshToken: { enabled: true, secret: STRONG, expiresIn: "7d" },
    } as never);

    expect((await run())?.status).toBe("ok");
  });

  it("warns on a signing secret shorter than 32 bytes", async () => {
    setConfig("auth", {
      userType: { user: class {} },
      accessToken: { secret: "short-secret", expiresIn: "1h" },
    } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("auth.accessToken.secret is 12 bytes");
  });

  it("warns on a short refresh secret", async () => {
    setConfig("auth", {
      userType: { user: class {} },
      accessToken: { secret: STRONG },
      refreshToken: { secret: "short" },
    } as never);

    expect((await run())?.detail).toContain("auth.refreshToken.secret is 5 bytes");
  });

  it("warns on never-expiring access tokens with refresh off (the legacy jwt block)", async () => {
    setConfig("auth", {
      userType: { user: class {} },
      jwt: { secret: STRONG, expiresIn: "100y", refresh: { enabled: false } },
    } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("never expire");
    expect(result?.detail).toContain("auth.refreshToken.enabled: true");
  });

  it("warns on access tokens living longer than 30 days", async () => {
    setConfig("auth", {
      userType: { user: class {} },
      accessToken: { secret: STRONG, expiresIn: "90d" },
    } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("longer than 30 days");
  });

  it("warns on multi-day access tokens with refresh tokens off", async () => {
    setConfig("auth", {
      userType: { user: class {} },
      accessToken: { secret: STRONG, expiresIn: "7d" },
      refreshToken: { enabled: false },
    } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("refresh tokens are off");
  });

  it("lists every finding when there are several", async () => {
    setConfig("auth", {
      userType: { user: class {} },
      jwt: { secret: "short", expiresIn: "100y" },
    } as never);

    const result = await run();

    expect(result?.detail).toContain("2 token settings to change");
  });

  it("leaves a missing secret to the jwt-secret check", async () => {
    setConfig("auth", { userType: { user: class {} }, accessToken: { expiresIn: "1h" } } as never);

    expect((await run())?.status).toBe("ok");
  });

  it("is silent when auth is not in use", async () => {
    setConfig("auth", { userType: {} } as never);

    expect(await run()).toBeUndefined();
  });

  it("is silent when @warlock.js/auth is not installed in the project", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "warlock-auth-doctor-"));
    vi.spyOn(process, "cwd").mockReturnValue(root);

    setConfig("auth", { userType: { user: class {} }, accessToken: { secret: "short" } } as never);

    try {
      expect(await run()).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("parseDurationMs", () => {
  it("reads the duration strings auth accepts", () => {
    expect(parseDurationMs("1h")).toBe(60 * 60 * 1000);
    expect(parseDurationMs("7d")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDurationMs("15 minutes")).toBe(15 * 60 * 1000);
    expect(parseDurationMs("100y")).toBeGreaterThan(99 * 365 * 24 * 60 * 60 * 1000);
  });

  it("answers undefined for anything else", () => {
    expect(parseDurationMs("30dayz")).toBeUndefined();
    expect(parseDurationMs(3600)).toBeUndefined();
    expect(parseDurationMs("")).toBeUndefined();
  });
});
