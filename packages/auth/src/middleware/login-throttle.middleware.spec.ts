import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheGet = vi.fn();
const cacheSet = vi.fn();
const cacheRemove = vi.fn();
const cacheIncrement = vi.fn();

vi.mock("@warlock.js/cache", () => ({
  cache: {
    get: (...args: unknown[]) => cacheGet(...args),
    set: (...args: unknown[]) => cacheSet(...args),
    remove: (...args: unknown[]) => cacheRemove(...args),
    increment: (...args: unknown[]) => cacheIncrement(...args),
  },
}));

vi.mock("@warlock.js/core", () => ({
  t: (key: string) => key,
}));

vi.mock("@warlock.js/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn() },
}));

import { loginThrottleMiddleware, throttleIdentifierHash } from "./login-throttle.middleware";
import { cache } from "@warlock.js/cache";
import { log } from "@warlock.js/logger";
import { AuthErrorCodes } from "../utils/auth-error-codes";
import { makeCtx } from "./test-support/make-ctx";

/** The throttle keys an account by a keyed hash of its trimmed, lower-cased credential. */
const SARA_KEY = throttleIdentifierHash("email", "sara@example.com");
const IP_KEY = throttleIdentifierHash("ip", "1.2.3.4");

type SentCallback = (response: FakeResponse) => void | Promise<void>;

type FakeRequest = {
  input: (key: string) => unknown;
  detectIp: () => string | undefined;
};

type FakeResponse = {
  isOk: boolean;
  onSent: (callback: SentCallback) => void;
  tooManyRequests: ReturnType<typeof vi.fn>;
  fireSent: () => Promise<void>;
};

function buildRequest(body: Record<string, unknown> = {}): FakeRequest {
  const merged: Record<string, unknown> = { email: "sara@example.com", ...body };

  return {
    input: (key: string) => merged[key],
    detectIp: () => "1.2.3.4",
  };
}

function buildResponse(isOk: boolean): FakeResponse {
  const callbacks: SentCallback[] = [];

  const response: FakeResponse = {
    isOk,
    onSent: (callback) => {
      callbacks.push(callback);
    },
    tooManyRequests: vi.fn(),
    fireSent: async () => {
      for (const callback of callbacks) {
        await callback(response);
      }
    },
  };

  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loginThrottleMiddleware", () => {
  it("rejects pre-controller with 429 when an identifier is already locked", async () => {
    cacheGet.mockImplementation((key: string) =>
      key.startsWith("auth.throttle.lock.") ? true : null,
    );

    const middleware = loginThrottleMiddleware();
    const request = buildRequest();
    const response = buildResponse(true);

    await middleware(makeCtx({ request, response }));

    expect(response.tooManyRequests).toHaveBeenCalledOnce();
    expect(response.tooManyRequests).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: AuthErrorCodes.TooManyAttempts }),
    );
  });

  it("seeds the failure counter with a TTL on the first failure (fixed window)", async () => {
    // the create-only seed opens the window; the bump is an atomic increment
    cacheGet.mockResolvedValue(null);
    cacheIncrement.mockResolvedValue(1);

    const middleware = loginThrottleMiddleware({ max: 5, window: "10m", by: ["email"] });
    const request = buildRequest();
    const response = buildResponse(false);

    await middleware(makeCtx({ request, response }));
    await response.fireSent();

    expect(cacheSet).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`, 0, {
      ttl: "10m",
      onConflict: "create",
    });
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`);
    // no lock yet — count (1) is below max (5)
    expect(cacheSet).not.toHaveBeenCalledWith(
      `auth.throttle.lock.email.${SARA_KEY}`,
      expect.anything(),
      expect.anything(),
    );
  });

  it("sets the lock key once the failure counter reaches `max`", async () => {
    // counter already exists → the create-only seed is a no-op (TTL preserved)
    cacheGet.mockResolvedValue(0);
    cacheIncrement.mockResolvedValue(5);

    const middleware = loginThrottleMiddleware({
      max: 5,
      lockoutDuration: "20m",
      by: ["email"],
    });
    const request = buildRequest();
    const response = buildResponse(false);

    await middleware(makeCtx({ request, response }));
    await response.fireSent();

    // The window is only ever seeded create-only, so an existing counter's TTL
    // survives the bump — fixed window.
    expect(cacheSet).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`, 0, {
      ttl: expect.anything(),
      onConflict: "create",
    });
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`);
    // The lock value is its own deadline: sliding-expiry
    // drivers cannot stretch a lockout.
    const lockCall = cacheSet.mock.calls.find((call) => call[0] === `auth.throttle.lock.email.${SARA_KEY}`);

    expect(lockCall?.[2]).toEqual({ ttl: "20m" });
    expect(lockCall?.[1]).toBeGreaterThan(Date.now() + 19 * 60_000);
    expect(lockCall?.[1]).toBeLessThanOrEqual(Date.now() + 20 * 60_000);
  });

  it("releases a lock whose stored deadline has passed even if the key is still alive", async () => {
    // a sliding-expiry driver kept the key alive past its deadline
    cacheGet.mockImplementation(async (key: string) =>
      key.startsWith("auth.throttle.lock.") ? Date.now() - 1_000 : null,
    );

    const middleware = loginThrottleMiddleware({ by: ["email"] });
    const response = buildResponse(true);

    await middleware(makeCtx({ request: buildRequest(), response }));

    expect(response.tooManyRequests).not.toHaveBeenCalled();
  });

  it("still honours a 5.29 lock stored as `true`", async () => {
    cacheGet.mockImplementation(async (key: string) => (key.startsWith("auth.throttle.lock.") ? true : null));

    const middleware = loginThrottleMiddleware({ by: ["email"] });
    const response = buildResponse(true);

    await middleware(makeCtx({ request: buildRequest(), response }));

    expect(response.tooManyRequests).toHaveBeenCalledOnce();
  });

  it("clears the counter and the lock on a successful response", async () => {
    cacheGet.mockResolvedValue(null);

    const middleware = loginThrottleMiddleware({ by: ["email"] });
    const request = buildRequest();
    const response = buildResponse(true);

    await middleware(makeCtx({ request, response }));
    await response.fireSent();

    expect(cacheRemove).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`);
    expect(cacheRemove).toHaveBeenCalledWith(`auth.throttle.lock.email.${SARA_KEY}`);
    expect(cacheIncrement).not.toHaveBeenCalled();
  });

  it("no-ops when no identifier can be extracted (request lacks email and ip)", async () => {
    const middleware = loginThrottleMiddleware();
    const request: FakeRequest = {
      input: () => undefined,
      detectIp: () => undefined,
    };
    const response = buildResponse(true);

    await middleware(makeCtx({ request, response }));

    expect(cacheGet).not.toHaveBeenCalled();
    expect(response.tooManyRequests).not.toHaveBeenCalled();
  });

  it("tracks every identifier independently — bumps the counter for each", async () => {
    cacheGet.mockResolvedValue(null);
    cacheIncrement.mockResolvedValue(1);

    const middleware = loginThrottleMiddleware({ by: ["email", "ip"] });
    const request = buildRequest();
    const response = buildResponse(false);

    await middleware(makeCtx({ request, response }));
    await response.fireSent();

    // both the per-account AND the per-source counter must be bumped
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`);
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.ip.${IP_KEY}`);
  });

  it("fails open when the cache rejects (driver outage must not escalate to an auth outage)", async () => {
    cacheGet.mockRejectedValue(new Error("CacheDriverNotInitialized"));

    const middleware = loginThrottleMiddleware();
    const request = buildRequest();
    const response = buildResponse(true);

    // must NOT throw and must NOT 429
    await expect(middleware(makeCtx({ request, response }))).resolves.toBeUndefined();
    expect(response.tooManyRequests).not.toHaveBeenCalled();
  });

  it("never puts the raw credential in a cache key, and ignores its case", async () => {
    cacheGet.mockResolvedValue(null);
    cacheIncrement.mockResolvedValue(1);

    const middleware = loginThrottleMiddleware({ by: ["email"] });
    const request = buildRequest({ email: "Sara@Example.COM" });
    const response = buildResponse(false);

    await middleware(makeCtx({ request, response }));
    await response.fireSent();

    const keys = [...cacheGet.mock.calls, ...cacheSet.mock.calls, ...cacheIncrement.mock.calls].map(
      (call) => String(call[0]),
    );

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((key) => key.toLowerCase().includes("sara@example.com"))).toBe(false);
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`);
  });

  it("trims the credential, so padded input shares the account's bucket", async () => {
    cacheGet.mockResolvedValue(null);
    cacheIncrement.mockResolvedValue(1);

    const middleware = loginThrottleMiddleware({ by: ["email"] });
    const response = buildResponse(false);

    await middleware(makeCtx({ request: buildRequest({ email: "  sara@example.com " }), response }));
    await response.fireSent();

    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`);
  });

  it("never puts the raw IP in a cache key", async () => {
    cacheGet.mockResolvedValue(null);
    cacheIncrement.mockResolvedValue(1);

    const middleware = loginThrottleMiddleware({ by: ["ip"] });
    const response = buildResponse(false);

    await middleware(makeCtx({ request: buildRequest(), response }));
    await response.fireSent();

    const keys = [...cacheGet.mock.calls, ...cacheSet.mock.calls, ...cacheIncrement.mock.calls].map(
      (call) => String(call[0]),
    );

    expect(keys.some((key) => key.includes("1.2.3.4"))).toBe(false);
  });
});

describe("null cache driver", () => {
  it("warns once that the throttle can never lock", async () => {
    (cache as unknown as { currentDriver?: { name: string } }).currentDriver = { name: "null" };
    cacheGet.mockResolvedValue(null);

    try {
      const middleware = loginThrottleMiddleware({ by: ["email"] });

      await middleware(makeCtx({ request: buildRequest(), response: buildResponse(true) }));
      await middleware(makeCtx({ request: buildRequest(), response: buildResponse(true) }));

      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(log.warn).mock.calls[0]?.[2])).toContain("null");
    } finally {
      delete (cache as unknown as { currentDriver?: unknown }).currentDriver;
    }
  });
});

describe("throttleIdentifierHash", () => {
  it("is stable, case- and whitespace-insensitive, and separates kinds", () => {
    expect(throttleIdentifierHash("email", " Sara@Example.com ")).toBe(
      throttleIdentifierHash("email", "sara@example.com"),
    );
    expect(throttleIdentifierHash("email", "1.2.3.4")).not.toBe(throttleIdentifierHash("ip", "1.2.3.4"));
    expect(throttleIdentifierHash("email", "sara@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});
