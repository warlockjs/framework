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
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`, 1, {
      ttl: "10m",
    });
    // no lock yet — count (1) is below max (5)
    expect(cacheSet).not.toHaveBeenCalledWith(
      `auth.throttle.lock.email.${SARA_KEY}`,
      expect.anything(),
      expect.anything(),
    );
  });

  it("sets the lock key once the failure counter reaches `max`", async () => {
    // counter already exists → the create-only seed is a no-op (TTL preserved)
    cacheGet.mockImplementation(async (key: string) =>
      key.startsWith("auth.throttle.count.") ? 5 : null,
    );
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
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`, 1, {
      ttl: "15m",
    });
    // The lock value is its own deadline: sliding-expiry
    // drivers cannot stretch a lockout.
    const lockCall = cacheSet.mock.calls.find(
      (call) => call[0] === `auth.throttle.lock.email.${SARA_KEY}`,
    );

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
    cacheGet.mockImplementation(async (key: string) =>
      key.startsWith("auth.throttle.lock.") ? true : null,
    );

    const middleware = loginThrottleMiddleware({ by: ["email"] });
    const response = buildResponse(true);

    await middleware(makeCtx({ request: buildRequest(), response }));

    expect(response.tooManyRequests).toHaveBeenCalledOnce();
  });

  it("resets the counter to 0 and clears the lock on a successful response", async () => {
    cacheGet.mockResolvedValue(null);

    const middleware = loginThrottleMiddleware({ by: ["email"] });
    const request = buildRequest();
    const response = buildResponse(true);

    await middleware(makeCtx({ request, response }));
    await response.fireSent();

    // 0, not deleted: a failure still in flight reads it as "a success reset the window"
    expect(cacheSet).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`, 0, {
      ttl: "15m",
    });
    expect(cacheRemove).not.toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`);
    expect(cacheRemove).toHaveBeenCalledWith(`auth.throttle.lock.email.${SARA_KEY}`);
    // counted once when it arrived, never again after the response
    expect(cacheIncrement).toHaveBeenCalledOnce();
  });

  it.each([
    ["comes back empty", async () => null],
    ["holds something that is not a count", async () => "garbage"],
    [
      "fails",
      async () => {
        throw new Error("read timed out");
      },
    ],
  ])("still locks at the limit when the counter re-read %s (fails closed)", async (_name, read) => {
    cacheIncrement.mockResolvedValue(5);
    cacheGet.mockImplementation(async (key: string) =>
      key.startsWith("auth.throttle.lock.") ? null : read(),
    );

    const middleware = loginThrottleMiddleware({ max: 5, by: ["email"] });
    const response = buildResponse(false);

    await middleware(makeCtx({ request: buildRequest(), response }));
    await response.fireSent();

    expect(cacheSet).toHaveBeenCalledWith(
      `auth.throttle.lock.email.${SARA_KEY}`,
      expect.any(Number),
      { ttl: "15m" },
    );
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
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`, 1, {
      ttl: "15m",
    });
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.ip.${IP_KEY}`, 1, {
      ttl: "15m",
    });
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
    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`, 1, {
      ttl: "15m",
    });
  });

  it("trims the credential, so padded input shares the account's bucket", async () => {
    cacheGet.mockResolvedValue(null);
    cacheIncrement.mockResolvedValue(1);

    const middleware = loginThrottleMiddleware({ by: ["email"] });
    const response = buildResponse(false);

    await middleware(
      makeCtx({ request: buildRequest({ email: "  sara@example.com " }), response }),
    );
    await response.fireSent();

    expect(cacheIncrement).toHaveBeenCalledWith(`auth.throttle.count.email.${SARA_KEY}`, 1, {
      ttl: "15m",
    });
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

/** A tiny in-process cache with the semantics the throttle relies on. */
function useMemoryCache(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  cacheGet.mockImplementation(async (key: string) => {
    await tick();

    return store.get(key) ?? null;
  });
  cacheSet.mockImplementation(
    async (key: string, value: unknown, options?: { onConflict?: string }) => {
      await tick();

      if (options?.onConflict === "create" && store.has(key)) return;

      store.set(key, value);
    },
  );
  cacheIncrement.mockImplementation(async (key: string, amount = 1) => {
    await tick();
    const next = Number(store.get(key) ?? 0) + amount;
    store.set(key, next);

    return next;
  });
  cacheRemove.mockImplementation(async (key: string) => {
    store.delete(key);
  });

  return store;
}

/** Run a slow failing "controller" behind the throttle, as a server would. */
async function attempt(
  middleware: ReturnType<typeof loginThrottleMiddleware>,
  controller: () => void,
  options: { ok?: boolean; ip?: string } = {},
): Promise<"refused" | "handled"> {
  const response = buildResponse(options.ok ?? false);
  const request = { ...buildRequest(), detectIp: () => options.ip ?? "1.2.3.4" };

  await middleware(makeCtx({ request, response }));

  if (response.tooManyRequests.mock.calls.length > 0) return "refused";

  controller();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await response.fireSent();

  return "handled";
}

describe("concurrent attempts", () => {
  it("lets at most `max` concurrent login attempts reach the controller", async () => {
    useMemoryCache();
    let reached = 0;
    const middleware = loginThrottleMiddleware({ max: 5, by: ["email", "ip"] });

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => attempt(middleware, () => reached++)),
    );

    expect(reached).toBe(5);
    expect(outcomes.filter((outcome) => outcome === "refused")).toHaveLength(15);
  });

  it("caps a concurrent burst of token-issue requests at the issue limit", async () => {
    useMemoryCache();
    let sent = 0;
    const middleware = loginThrottleMiddleware({
      max: 3,
      window: "1h",
      lockoutDuration: "1h",
      isFailure: () => true,
    });

    await Promise.all(
      Array.from({ length: 12 }, () => attempt(middleware, () => sent++, { ok: true })),
    );

    expect(sent).toBe(3);
  });

  it("does not lock an account whose correct login finished while a wrong one was in flight", async () => {
    const store = useMemoryCache();
    const middleware = loginThrottleMiddleware({ max: 3, by: ["email"] });

    await attempt(middleware, () => {});

    // The correct attempt arrives, then a mistyped one takes the last allowed
    // slot; the correct one finishes first.
    const right = buildResponse(true);
    await middleware(makeCtx({ request: buildRequest(), response: right }));
    const wrong = buildResponse(false);
    await middleware(makeCtx({ request: buildRequest(), response: wrong }));
    await right.fireSent();
    await wrong.fireSent();

    expect(right.tooManyRequests).not.toHaveBeenCalled();
    expect(wrong.tooManyRequests).not.toHaveBeenCalled();
    expect(store.has(`auth.throttle.lock.email.${SARA_KEY}`)).toBe(false);
    expect(await attempt(middleware, () => {}, { ok: true })).toBe("handled");
  });

  it("starts a fresh window for the identifier once its lockout ends", async () => {
    const store = useMemoryCache();
    const middleware = loginThrottleMiddleware({ max: 2, by: ["email"] });

    await attempt(middleware, () => {});
    await attempt(middleware, () => {});
    expect(await attempt(middleware, () => {})).toBe("refused");

    // the lock and the counter share one TTL, so both are gone together
    store.delete(`auth.throttle.lock.email.${SARA_KEY}`);
    store.delete(`auth.throttle.count.email.${SARA_KEY}`);

    expect(await attempt(middleware, () => {}, { ok: true })).toBe("handled");
  });
});

describe("emailLock", () => {
  it('"global" (default): failures from one IP lock the email for every IP', async () => {
    useMemoryCache();
    const middleware = loginThrottleMiddleware({ max: 5 });

    for (let index = 0; index < 5; index++) {
      await attempt(middleware, () => {}, { ip: "6.6.6.6" });
    }

    expect(await attempt(middleware, () => {}, { ok: true, ip: "1.2.3.4" })).toBe("refused");
  });

  it('"pair": failures from one IP do not block a correct login from another IP', async () => {
    useMemoryCache();
    const middleware = loginThrottleMiddleware({ max: 5, emailLock: "pair" });

    for (let index = 0; index < 5; index++) {
      await attempt(middleware, () => {}, { ip: "6.6.6.6" });
    }

    expect(await attempt(middleware, () => {}, { ip: "6.6.6.6" })).toBe("refused");
    expect(await attempt(middleware, () => {}, { ok: true, ip: "1.2.3.4" })).toBe("handled");
  });

  it('"pair": the email-wide bucket still locks guessing spread over many IPs', async () => {
    useMemoryCache();
    const middleware = loginThrottleMiddleware({ max: 5, emailLock: "pair", accountMax: 6 });

    for (let index = 0; index < 6; index++) {
      await attempt(middleware, () => {}, { ip: `10.0.0.${index}` });
    }

    expect(await attempt(middleware, () => {}, { ok: true, ip: "1.2.3.4" })).toBe("refused");
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
    expect(throttleIdentifierHash("email", "1.2.3.4")).not.toBe(
      throttleIdentifierHash("ip", "1.2.3.4"),
    );
    expect(throttleIdentifierHash("email", "sara@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});
