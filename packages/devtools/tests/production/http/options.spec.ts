import { describe, expect, it } from "vitest";
import { DevtoolsProductionConfigError } from "../../../src/production/errors";
import {
  DEVTOOLS_PRODUCTION_DEFAULTS,
  resolveProductionOptions,
} from "../../../src/production/options";
import type { DevtoolsProductionOptions } from "../../../src/types";

const env = { DEVTOOLS_PATH: "/ops-7f3k2q9x" };

/** The refusal code `resolveProductionOptions` throws, or `null` when it resolves. */
function codeOf(
  options: DevtoolsProductionOptions | undefined,
  environment: Record<string, string | undefined> = env,
): string | null {
  try {
    resolveProductionOptions(options, environment);

    return null;
  } catch (error) {
    if (error instanceof DevtoolsProductionConfigError) return error.code;

    throw error;
  }
}

describe("resolveProductionOptions defaults", () => {
  it("applies every default and reads the path and admin from the environment", () => {
    const resolved = resolveProductionOptions(undefined, {
      ...env,
      DEVTOOLS_ADMIN_EMAIL: "admin@example.com",
      DEVTOOLS_ADMIN_PASSWORD: "a long password",
    });

    expect(resolved).toMatchObject({
      path: "/ops-7f3k2q9x",
      admin: { email: "admin@example.com", password: "a long password", setupToken: null },
      sampleRate: 0.1,
      slowRequestMs: 1000,
      slowQueryMs: 200,
      maxRequests: 200,
      maxQueriesPerRequest: 200,
      maxShapes: 500,
      maxRoutes: 300,
      maxErrorGroups: 100,
      requestRetentionHours: 24,
      maxStoredSamplesPerMinute: 120,
      reportIntervalMs: 10_000,
      trustedProxies: [],
      requireHttps: true,
      allowedIps: [],
      origin: null,
      session: { idleMinutes: 30, maxHours: 8, pendingMinutes: 10 },
      twoFactor: "admins",
      passwords: { minLength: 8, rejectCommon: true },
      rateLimits: { windowMinutes: 15, account: 5, ip: 20, global: 100, lockMinutes: 15 },
      explain: { executing: false },
      panels: {},
      logLevels: ["warn", "error"],
      auditRetentionDays: 90,
      passkeys: { rpName: "Warlock monitor", rpId: null },
      share: { enabled: false, maxDays: 30 },
    });
    expect(resolved.sampleRate).toBe(DEVTOOLS_PRODUCTION_DEFAULTS.sampleRate);
  });

  it("treats empty environment values as unset", () => {
    const resolved = resolveProductionOptions(undefined, {
      ...env,
      DEVTOOLS_ADMIN_EMAIL: "",
      DEVTOOLS_ADMIN_PASSWORD: "",
      DEVTOOLS_SETUP_TOKEN: "",
    });

    expect(resolved.admin).toEqual({ email: null, password: null, setupToken: null });
  });

  it("lets the option path win over the environment and drops a trailing slash", () => {
    expect(
      resolveProductionOptions({ path: "/monitor-9x8y7z/" }, { DEVTOOLS_PATH: "/other-path-1" })
        .path,
    ).toBe("/monitor-9x8y7z");
  });

  it("keeps the values the project sets", () => {
    const resolved = resolveProductionOptions(
      {
        sampleRate: 0,
        slowRequestMs: 500,
        trustedProxies: ["loopback", "10.0.0.0/8", "2001:db8::/32"],
        allowedIps: ["203.0.113.7"],
        origin: "https://app.example.com",
        session: { idleMinutes: 10 },
        twoFactor: "everyone",
        explain: { executing: true },
        panels: { mail: true, grimoire: false },
        logLevels: ["error"],
        passkeys: { rpName: "Ops", rpId: "example.com" },
      },
      env,
    );

    expect(resolved).toMatchObject({
      sampleRate: 0,
      slowRequestMs: 500,
      trustedProxies: ["loopback", "10.0.0.0/8", "2001:db8::/32"],
      allowedIps: ["203.0.113.7"],
      origin: "https://app.example.com",
      session: { idleMinutes: 10, maxHours: 8 },
      twoFactor: "everyone",
      explain: { executing: true },
      panels: { mail: true, grimoire: false },
      logLevels: ["error"],
      passkeys: { rpName: "Ops", rpId: "example.com" },
    });
  });
});

describe("resolveProductionOptions refusals", () => {
  it("DT001: no path anywhere", () => {
    expect(codeOf(undefined, {})).toBe("DT001");
    expect(codeOf({}, { DEVTOOLS_PATH: "" })).toBe("DT001");
  });

  it.each([
    ["no leading slash", "ops-7f3k2q9x"],
    ["too short", "/ops-1"],
    ["a forbidden character", "/ops 7f3k2q9x"],
    ["a query character", "/ops-7f3k2q9x?x"],
    ["the development path", "/__warlock"],
    ["below the development path", "/__warlock/more"],
    ["an empty segment", "/ops-7f3k//2q9x"],
    ["a dot segment", "/ops-7f3k/../2q9x"],
    ["only slashes", "////////"],
  ])("DT002: %s", (_name, path) => {
    expect(codeOf({ path })).toBe("DT002");
  });

  it("accepts a path of exactly eight characters", () => {
    expect(codeOf({ path: "/abcdefg" })).toBeNull();
  });

  it.each([
    ["sampleRate above 1", { sampleRate: 1.5 }],
    ["sampleRate below 0", { sampleRate: -0.1 }],
    ["sampleRate not a number", { sampleRate: Number.NaN }],
    ["slowRequestMs zero", { slowRequestMs: 0 }],
    ["slowQueryMs fractional", { slowQueryMs: 1.5 }],
    ["maxRequests negative", { maxRequests: -1 }],
    ["requestRetentionHours zero", { requestRetentionHours: 0 }],
    ["maxStoredSamplesPerMinute zero", { maxStoredSamplesPerMinute: 0 }],
    ["reportIntervalMs zero", { reportIntervalMs: 0 }],
    ["auditRetentionDays zero", { auditRetentionDays: 0 }],
    ["session.idleMinutes zero", { session: { idleMinutes: 0 } }],
    ["session.maxHours zero", { session: { maxHours: 0 } }],
    ["rateLimits.account zero", { rateLimits: { account: 0 } }],
    ["rateLimits.ip negative", { rateLimits: { ip: -5 } }],
    ["rateLimits.global zero", { rateLimits: { global: 0 } }],
    ["rateLimits.lockMinutes zero", { rateLimits: { lockMinutes: 0 } }],
    ["rateLimits.windowMinutes zero", { rateLimits: { windowMinutes: 0 } }],
    ["unknown twoFactor", { twoFactor: "nobody" }],
    ["passwords.minLength below 8", { passwords: { minLength: 6 } }],
    ["passwords.minLength above the 72-byte limit", { passwords: { minLength: 100 } }],
    ["passwords.minLength fractional", { passwords: { minLength: 10.5 } }],
    ["passwords.rejectCommon not a boolean", { passwords: { rejectCommon: "no" } }],
    ["a bad trustedProxies entry", { trustedProxies: ["not-an-ip"] }],
    ["a bad CIDR prefix", { trustedProxies: ["10.0.0.0/33"] }],
    ["a bad IPv6 CIDR prefix", { allowedIps: ["2001:db8::/129"] }],
    ["a bad allowedIps entry", { allowedIps: ["10.0.0.0/x"] }],
    ["origin with a path", { origin: "https://app.example.com/ops" }],
    ["origin with a trailing slash", { origin: "https://app.example.com/" }],
    ["origin over http", { origin: "http://app.example.com" }],
    ["origin without a scheme", { origin: "app.example.com" }],
    ["panels with a non-boolean", { panels: { mail: "yes" } }],
    ["panels as a list", { panels: ["mail"] }],
    ["an unknown log level", { logLevels: ["warn", "loud"] }],
    ["a non-boolean requireHttps", { requireHttps: "no" }],
    ["a non-boolean explain.executing", { explain: { executing: "yes" } }],
    ["an empty passkeys.rpName", { passkeys: { rpName: " " } }],
    ["a non-boolean share.enabled", { share: { enabled: "yes" } }],
    ["share.maxDays of 0", { share: { maxDays: 0 } }],
    ["share.maxDays over a year", { share: { maxDays: 366 } }],
    ["a fractional share.maxDays", { share: { maxDays: 1.5 } }],
  ] as [string, Record<string, unknown>][])("DT007: %s", (_name, options) => {
    expect(codeOf(options as DevtoolsProductionOptions)).toBe("DT007");
  });

  it("DT007 names the option and what to use", () => {
    expect(() => resolveProductionOptions({ sampleRate: 2 }, env)).toThrow(
      /devtools\.production\.sampleRate.*0 to 1/,
    );
  });

  it("DT007 names share.maxDays and the accepted range", () => {
    expect(() => resolveProductionOptions({ share: { maxDays: 400 } }, env)).toThrow(
      /devtools\.production\.share\.maxDays.*1 to 365/,
    );
  });

  it("resolves the share options", () => {
    expect(resolveProductionOptions({ share: { enabled: true } }, env).share).toEqual({
      enabled: true,
      maxDays: 30,
    });
    expect(resolveProductionOptions({ share: { enabled: true, maxDays: 365 } }, env).share).toEqual(
      { enabled: true, maxDays: 365 },
    );
  });

  it("accepts an http origin only when HTTPS is not required", () => {
    expect(codeOf({ origin: "http://localhost:3000", requireHttps: false })).toBeNull();
    expect(codeOf({ origin: "http://localhost:3000" })).toBe("DT007");
  });

  it("accepts the shapes of network entries it documents", () => {
    expect(
      codeOf({
        trustedProxies: ["loopback", "private", "127.0.0.1", "::1", "::ffff:10.0.0.1", "fd00::/8"],
      }),
    ).toBeNull();
  });

  it("DT009: both a password and a setup token", () => {
    expect(
      codeOf(
        {},
        {
          ...env,
          DEVTOOLS_ADMIN_PASSWORD: "a long password",
          DEVTOOLS_SETUP_TOKEN: "x".repeat(40),
        },
      ),
    ).toBe("DT009");
  });

  it("DT010: a setup token shorter than 32 characters", () => {
    expect(codeOf({}, { ...env, DEVTOOLS_SETUP_TOKEN: "x".repeat(31) })).toBe("DT010");
    expect(codeOf({}, { ...env, DEVTOOLS_SETUP_TOKEN: "x".repeat(32) })).toBeNull();
  });

  it("checks the path before the other settings", () => {
    expect(codeOf({ sampleRate: 5 }, {})).toBe("DT001");
    expect(codeOf({ sampleRate: 5, path: "/__warlock" }, {})).toBe("DT002");
  });

  it("leaves the administrator checks (DT003, DT004) to the database step", () => {
    expect(codeOf({}, { ...env, DEVTOOLS_ADMIN_PASSWORD: "short" })).toBeNull();
    expect(codeOf({}, env)).toBeNull();
  });
});
