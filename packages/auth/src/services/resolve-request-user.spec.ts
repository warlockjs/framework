import { beforeEach, describe, expect, it, vi } from "vitest";

const configKey = vi.fn();
const jwtVerify = vi.fn();
const accessTokenFindByToken = vi.fn();
const renewAutomaticSession = vi.fn();
const setAuthCookie = vi.fn();
const canAuthenticate = vi.fn();

vi.mock("@warlock.js/core", () => ({
  config: { key: (...args: unknown[]) => configKey(...args) },
}));

vi.mock("@warlock.js/logger", () => ({
  log: { error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./jwt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jwt")>();

  return {
    ...actual,
    jwt: { ...actual.jwt, verify: (...args: unknown[]) => jwtVerify(...args) },
  };
});

vi.mock("../models/access-token", () => ({
  AccessToken: { findByToken: (...args: unknown[]) => accessTokenFindByToken(...args) },
}));

vi.mock("./auth.service", () => ({
  authService: {
    canAuthenticate: (...args: unknown[]) => canAuthenticate(...args),
    renewAutomaticSession: (...args: unknown[]) => renewAutomaticSession(...args),
    setAuthCookie: (...args: unknown[]) => setAuthCookie(...args),
  },
}));

import { resolveRequestUser, resolveRequestUserOutcome } from "./resolve-request-user";

const user = { id: 1, userType: "user" };

function buildRequest(authorizationValue?: string, cookies: Record<string, string> = {}) {
  return {
    authorizationValue,
    cookie: vi.fn((name: string) => cookies[name]),
    locals: { user: "stale" as unknown },
    decodedAccessToken: undefined as unknown,
  };
}

function liveRow(fields: Record<string, unknown> = {}) {
  return { isExpired: false, userId: 1, userType: "user", destroy: vi.fn(), ...fields };
}

function stubConfig(userModel: unknown) {
  configKey.mockImplementation((key: string, fallback?: unknown) =>
    key.startsWith("auth.userType.") ? userModel : fallback,
  );
}

const run = (request: unknown, options?: Parameters<typeof resolveRequestUser>[2]) =>
  resolveRequestUser(request as never, {} as never, options);

beforeEach(() => {
  vi.clearAllMocks();
  canAuthenticate.mockResolvedValue(true);
  renewAutomaticSession.mockResolvedValue(null);
});

describe("token row and claims must name the same user", () => {
  it("refuses a token whose id claim differs from the user its row was issued to", async () => {
    jwtVerify.mockResolvedValue({ id: 2, userType: "user" });
    accessTokenFindByToken.mockResolvedValue(liveRow({ userId: 1 }));
    const find = vi.fn().mockResolvedValue({ id: 2, userType: "user" });
    stubConfig({ find });

    const outcome = await resolveRequestUserOutcome(buildRequest("token") as never, {} as never);

    expect(outcome).toEqual({ user: null, failure: "invalid" });
    expect(find).not.toHaveBeenCalled();
  });

  it("refuses a token whose userType claim differs from its row", async () => {
    jwtVerify.mockResolvedValue({ id: 1, userType: "admin" });
    accessTokenFindByToken.mockResolvedValue(liveRow({ userId: 1, userType: "user" }));
    stubConfig({ find: vi.fn().mockResolvedValue(user) });

    const outcome = await resolveRequestUserOutcome(buildRequest("token") as never, {} as never);

    expect(outcome.failure).toBe("invalid");
  });

  it("matches ids across number and string forms", async () => {
    jwtVerify.mockResolvedValue({ id: "1", userType: "user" });
    accessTokenFindByToken.mockResolvedValue(liveRow({ userId: 1 }));
    stubConfig({ find: vi.fn().mockResolvedValue(user) });

    expect(await run(buildRequest("token"))).toBe(user);
  });
});

describe("resolveRequestUser", () => {
  it("returns the user for a live token and records the decoded claims", async () => {
    jwtVerify.mockResolvedValue({ id: 1, userType: "user" });
    accessTokenFindByToken.mockResolvedValue(liveRow());
    stubConfig({ find: vi.fn().mockResolvedValue(user) });
    const request = buildRequest("token");

    expect(await run(request)).toBe(user);
    expect(request.decodedAccessToken).toEqual({ id: 1, userType: "user" });
  });

  it("returns null and clears locals.user when there is no credential", async () => {
    const request = buildRequest(undefined);

    expect(await run(request)).toBeNull();
    expect(request.locals.user).toBeUndefined();
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("returns null for a token row the model reports expired, and destroys it", async () => {
    const row = liveRow({ isExpired: true });
    jwtVerify.mockResolvedValue({ id: 1, userType: "user" });
    accessTokenFindByToken.mockResolvedValue(row);

    expect(await run(buildRequest("token"))).toBeNull();
    expect(row.destroy).toHaveBeenCalled();
  });

  it("reports a disallowed user type as forbidden", async () => {
    jwtVerify.mockResolvedValue({ id: 1, userType: "user" });
    accessTokenFindByToken.mockResolvedValue(liveRow());

    const outcome = await resolveRequestUserOutcome(buildRequest("token") as never, {} as never, {
      allowedTypes: ["admin"],
    });

    expect(outcome).toEqual({ user: null, failure: "forbidden" });
  });

  it("reports a user that cannot authenticate as unauthorized", async () => {
    jwtVerify.mockResolvedValue({ id: 1, userType: "user" });
    accessTokenFindByToken.mockResolvedValue(liveRow());
    stubConfig({ find: vi.fn().mockResolvedValue(user) });
    canAuthenticate.mockResolvedValue(false);

    const outcome = await resolveRequestUserOutcome(buildRequest("token") as never, {} as never);

    expect(outcome).toEqual({ user: null, failure: "unauthorized" });
  });

  it("does not renew without an explicit renewal user type", async () => {
    const request = buildRequest(undefined, { refresh: "old-refresh" });
    const resolved = await resolveRequestUser(request as never, {} as never, {
      tokenFrom: "cookie:access",
      refreshCredential: "cookie:refresh",
    });
    expect(resolved).toBeNull();
    expect(renewAutomaticSession).not.toHaveBeenCalled();
    expect(setAuthCookie).not.toHaveBeenCalled();
  });

  it("renews once from the refresh cookie and writes the rotated pair", async () => {
    jwtVerify.mockResolvedValue({ id: 1, userType: "user" });
    accessTokenFindByToken.mockResolvedValue(liveRow());
    stubConfig({ find: vi.fn().mockResolvedValue(user) });
    renewAutomaticSession.mockResolvedValue({
      accessToken: { token: "next-access" },
      refreshToken: { token: "next-refresh" },
    });
    const request = buildRequest(undefined, { refresh: "old-refresh" });
    const response = {};

    const resolved = await resolveRequestUser(request as never, response as never, {
      tokenFrom: "cookie:access",
      refreshCredential: "cookie:refresh",
      overlapMs: 4_000,
      allowedTypes: ["user"],
      renewalUserType: "user",
      cookieDomain: () => ".example.com",
    });

    expect(resolved).toBe(user);
    expect(renewAutomaticSession).toHaveBeenCalledWith("old-refresh", "user", { overlapMs: 4_000 });
    expect(setAuthCookie).toHaveBeenNthCalledWith(
      1,
      response,
      expect.objectContaining({ token: "next-access" }),
      { name: "access", domain: ".example.com" },
    );
    expect(setAuthCookie).toHaveBeenNthCalledWith(
      2,
      response,
      expect.objectContaining({ token: "next-refresh" }),
      { name: "refresh", domain: ".example.com" },
    );
    expect(accessTokenFindByToken).toHaveBeenCalledWith("next-access");
  });
});

describe("auth.cookie.hostPrefix reads", () => {
  function stubWithHostPrefix(userModel: unknown) {
    configKey.mockImplementation((key: string, fallback?: unknown) => {
      if (key === "auth.cookie.hostPrefix") return true;

      return key.startsWith("auth.userType.") ? userModel : fallback;
    });
  }

  it("reads the __Host- cookie first", async () => {
    jwtVerify.mockResolvedValue({ id: 1, userType: "user" });
    accessTokenFindByToken.mockResolvedValue(liveRow());
    stubWithHostPrefix({ find: vi.fn().mockResolvedValue(user) });
    const request = buildRequest(undefined, {
      "__Host-access_token": "prefixed",
      access_token: "legacy",
    });

    await resolveRequestUserOutcome(request as never, {} as never, {
      tokenFrom: "cookie:access_token",
    });

    expect(jwtVerify).toHaveBeenCalledWith("prefixed");
  });

  it("still accepts the unprefixed cookie written before the switch", async () => {
    jwtVerify.mockResolvedValue({ id: 1, userType: "user" });
    accessTokenFindByToken.mockResolvedValue(liveRow());
    stubWithHostPrefix({ find: vi.fn().mockResolvedValue(user) });
    const request = buildRequest(undefined, { access_token: "legacy" });

    const outcome = await resolveRequestUserOutcome(request as never, {} as never, {
      tokenFrom: "cookie:access_token",
    });

    expect(outcome.user).toBe(user);
    expect(jwtVerify).toHaveBeenCalledWith("legacy");
  });
});
