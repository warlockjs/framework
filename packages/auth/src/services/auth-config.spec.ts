import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configKey = vi.fn();
const logWarn = vi.fn();

vi.mock("@warlock.js/core", () => ({
  config: { key: (...args: unknown[]) => configKey(...args) },
}));

vi.mock("@warlock.js/logger", () => ({
  log: { warn: (...args: unknown[]) => logWarn(...args) },
}));

import { NO_EXPIRATION } from "../contracts/types";
import { authConfig } from "./auth-config";

beforeEach(() => {
  vi.clearAllMocks();
  configKey.mockReturnValue(undefined);
});

describe("authConfig resolver", () => {
  it("prefers the new accessToken.* / refreshToken.* key", () => {
    configKey.mockImplementation((key: string) =>
      key === "auth.accessToken.secret" ? "new-secret" : undefined,
    );

    expect(authConfig.accessToken.secret()).toBe("new-secret");
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("falls back to the deprecated jwt.* key and warns", () => {
    configKey.mockImplementation((key: string) =>
      key === "auth.jwt.secret" ? "legacy-secret" : undefined,
    );

    expect(authConfig.accessToken.secret()).toBe("legacy-secret");
    expect(logWarn).toHaveBeenCalledOnce();
  });

  it("returns the documented defaults when nothing is configured", () => {
    expect(authConfig.accessToken.algorithm()).toBe("HS256");
    expect(authConfig.accessToken.expiresIn()).toBeUndefined();
    expect(authConfig.refreshToken.enabled()).toBe(true);
    expect(authConfig.refreshToken.expiresIn()).toBe("7d");
    expect(authConfig.refreshToken.rotation()).toBe(true);
    expect(authConfig.refreshToken.maxPerUser()).toBe(5);
    expect(authConfig.refreshToken.logoutWithoutToken()).toBe("revoke-all");
  });

  it("honours a falsy-but-set value rather than the default", () => {
    configKey.mockImplementation((key: string) =>
      key === "auth.refreshToken.enabled" ? false : undefined,
    );

    expect(authConfig.refreshToken.enabled()).toBe(false);
  });

  it("warns at most once for the same legacy key", () => {
    configKey.mockImplementation((key: string) =>
      key === "auth.jwt.refresh.rotation" ? false : undefined,
    );

    authConfig.refreshToken.rotation();
    authConfig.refreshToken.rotation();

    expect(logWarn).toHaveBeenCalledOnce();
  });
});

describe("authConfig expiresInMs", () => {
  function withConfig(key: string, value: unknown) {
    configKey.mockImplementation((configuredKey: string) =>
      configuredKey === key ? value : undefined,
    );
  }

  it("parses a valid access-token duration to milliseconds", () => {
    withConfig("auth.accessToken.expiresIn", "30 days");

    expect(authConfig.accessToken.expiresInMs()).toBe(2_592_000_000);
  });

  it("defaults the access token to 1h when unset", () => {
    expect(authConfig.accessToken.expiresInMs()).toBe(3_600_000);
  });

  it("defaults the refresh token to 7d when unset", () => {
    expect(authConfig.refreshToken.expiresInMs()).toBe(604_800_000);
  });

  it("resolves through the deprecated jwt.* keys too", () => {
    withConfig("auth.jwt.expiresIn", "2h");

    expect(authConfig.accessToken.expiresInMs()).toBe(7_200_000);
  });

  it.each(["30dayz", "thirty days", "0d", "-1h", "", 2_592_000, true])(
    "throws naming auth.accessToken.expiresIn for %o",
    (value) => {
      withConfig("auth.accessToken.expiresIn", value);

      expect(() => authConfig.accessToken.expiresInMs()).toThrow(/auth\.accessToken\.expiresIn/);
    },
  );

  it.each(["30dayz", "0d", ""])("throws naming auth.refreshToken.expiresIn for %o", (value) => {
    withConfig("auth.refreshToken.expiresIn", value);

    expect(() => authConfig.refreshToken.expiresInMs()).toThrow(/auth\.refreshToken\.expiresIn/);
  });

  it("quotes the offending value in the error message", () => {
    withConfig("auth.accessToken.expiresIn", "30dayz");

    expect(() => authConfig.accessToken.expiresInMs()).toThrow(/"30dayz"/);
  });

  it("accepts NO_EXPIRATION", () => {
    withConfig("auth.accessToken.expiresIn", NO_EXPIRATION);

    expect(authConfig.accessToken.expiresInMs()).toBe(3_155_760_000_000);
  });
});

describe("authConfig cookie.refreshName", () => {
  it("defaults to refresh_token", () => {
    configKey.mockImplementation((_key: string, fallback?: unknown) => fallback);

    expect(authConfig.cookie.refreshName()).toBe("refresh_token");
  });

  it("honours the auth.cookie.refreshName override", () => {
    configKey.mockImplementation((key: string, fallback?: unknown) =>
      key === "auth.cookie.refreshName" ? "rt" : fallback,
    );

    expect(authConfig.cookie.refreshName()).toBe("rt");
  });
});

describe("production configuration warnings", () => {
  const previousEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = previousEnv;
  });

  it("accepts a 64-character secret silently", () => {
    configKey.mockImplementation((key: string) =>
      key === "auth.accessToken.secret" ? "a".repeat(64) : undefined,
    );

    authConfig.accessToken.secret();

    expect(logWarn).not.toHaveBeenCalled();
  });

  it("warns once, without throwing, about a secret shorter than 32 bytes", () => {
    configKey.mockImplementation((key: string) =>
      key === "auth.accessToken.secret" ? "secret" : undefined,
    );

    expect(authConfig.accessToken.secret()).toBe("secret");
    authConfig.accessToken.secret();

    expect(logWarn).toHaveBeenCalledOnce();
    expect(String(logWarn.mock.calls[0]?.[2])).toContain("jwt.generate");
  });

  it("warns once about an access-token lifetime over 30 days", () => {
    configKey.mockImplementation((key: string) =>
      key === "auth.accessToken.expiresIn" ? NO_EXPIRATION : undefined,
    );

    authConfig.accessToken.expiresInMs();
    authConfig.accessToken.expiresInMs();

    expect(logWarn).toHaveBeenCalledOnce();
    expect(String(logWarn.mock.calls[0]?.[2])).toContain("30 days");
  });

  it("stays quiet outside production", () => {
    process.env.NODE_ENV = "development";
    configKey.mockImplementation((key: string) =>
      key === "auth.refreshToken.secret" ? "short" : undefined,
    );

    authConfig.refreshToken.secret();

    expect(logWarn).not.toHaveBeenCalled();
  });
});
