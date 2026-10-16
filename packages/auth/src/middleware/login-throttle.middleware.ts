import { createHash, createHmac } from "node:crypto";
import { cache } from "@warlock.js/cache";
import { t, type Middleware, type Request, type Response } from "@warlock.js/core";
import { log } from "@warlock.js/logger";
import ms from "ms";
import { authConfig } from "../services/auth-config";
import { AuthErrorCodes } from "../utils/auth-error-codes";

/**
 * Built-in identifier kinds the throttle knows how to extract from a request.
 *
 * - `"email"` tracks per-account, so an attacker can't spray one user from
 *   many IPs.
 * - `"ip"` tracks per-source, so an attacker can't stuff many accounts from
 *   one IP.
 *
 * Lockout trips when ANY tracked identifier crosses `max` — defense-in-depth.
 */
export type LoginThrottleIdentifier = "email" | "ip";

/**
 * Options for {@link loginThrottleMiddleware}.
 *
 * Failure-aware by design: only counts requests whose response is non-2xx
 * (or whatever `isFailure` says) and resets on success, so a user who types
 * a wrong password three times then the right one is not penalised.
 *
 * @example
 * loginThrottleMiddleware({ max: 5, window: "15m", lockoutDuration: "15m" });
 */
export type LoginThrottleOptions = {
  /**
   * Failures allowed within the window before the identifier is locked.
   *
   * @default 5
   */
  max?: number;

  /**
   * Counting window. `ms`-format string (`"15m"`, `"1h"`) or seconds as a number.
   *
   * @default "15m"
   */
  window?: string | number;

  /**
   * Lockout duration once the threshold is tripped. `ms`-format string or seconds.
   *
   * @default "15m"
   */
  lockoutDuration?: string | number;

  /**
   * Identifiers tracked. Each is counted and locked independently.
   *
   * @default ["email", "ip"]
   */
  by?: LoginThrottleIdentifier[];

  /**
   * Credential field consulted when `"email"` is tracked. Switch to
   * `"username"` (or any other input field) for systems that don't
   * authenticate by email.
   *
   * @default "email"
   */
  identifierKey?: string;

  /**
   * Override the default error message returned with the 429 response.
   */
  errorMessage?: string;

  /**
   * Decide whether the response represents a failed login. Defaults to
   * "non-2xx is a failure"; override if your controller signals failure
   * through a 200-style body.
   *
   * @default (response) => !response.isOk
   */
  isFailure?: (response: Response) => boolean;

  /**
   * Compute the identifiers tracked for this request. Override to derive the
   * account key from a header, a JWT subject, or any other shape that does
   * not match the built-in `email` / `ip` extraction.
   */
  identify?: (request: Request) => string[];
};

const COUNTER_PREFIX = "auth.throttle.count.";
const LOCK_PREFIX = "auth.throttle.lock.";

const counterKey = (identifier: string): string => `${COUNTER_PREFIX}${identifier}`;
const lockKey = (identifier: string): string => `${LOCK_PREFIX}${identifier}`;

/**
 * The key a throttle identifier is hashed with: an HMAC key derived from
 * `auth.accessToken.secret` (the same root the OTP code MAC uses), or
 * `undefined` when no secret is configured.
 */
function throttleHashKey(): Buffer | undefined {
  let secret: string | undefined;

  try {
    secret = authConfig.accessToken.secret();
  } catch {
    return undefined;
  }

  return createHmac("sha256", secret).update("@warlock.js/auth:throttle").digest();
}

/**
 * Hash of a throttle identifier (`kind` is `"email"`, `"ip"`, ...). The value
 * is trimmed and lower-cased first, so `" Sara@x.io"` and `"sara@x.io"` share
 * one bucket.
 *
 * Identifiers become part of cache keys, and cache drivers log their keys: a
 * raw email or IP there is personal data in a log line. A plain SHA-256 of an
 * email is reversible by anyone with a list of addresses, so the hash is
 * keyed (HMAC) with a key derived from `auth.accessToken.secret`. Without a
 * configured secret it falls back to SHA-256, which still keeps the address
 * out of the key.
 *
 * Exported for tests and for apps that inspect throttle keys.
 */
export function throttleIdentifierHash(kind: string, value: string): string {
  const normalized = `${kind}:${value.trim().toLowerCase()}`;
  const key = throttleHashKey();

  return key
    ? createHmac("sha256", key).update(normalized).digest("hex")
    : createHash("sha256").update(normalized).digest("hex");
}

let warnedNullDriver = false;

/**
 * The `null` cache driver stores nothing: every count reads back as 1 and no
 * lock is ever found, so the throttle silently never trips. Say so once.
 */
function warnIfNullDriver(): void {
  if (warnedNullDriver) return;

  const driverName = (cache as { currentDriver?: { name?: string } }).currentDriver?.name;

  if (driverName !== "null") return;

  warnedNullDriver = true;
  log.warn(
    "auth",
    "login-throttle",
    "The cache driver is `null`, so login, token and OTP throttles never lock. Use a real cache driver (redis, pg, or memory for one process).",
  );
}

/**
 * A lock value is the lockout deadline (epoch ms). `true`, written by 5.29
 * and earlier, still counts as locked until the key expires.
 */
function isLocked(value: unknown): boolean {
  if (typeof value === "number") {
    return value > Date.now();
  }

  return Boolean(value);
}

/**
 * `ms`'s honest runtime signature (see `services/auth-config.ts`): it returns
 * `undefined` for text it cannot parse and throws for `""`.
 */
const parseMs = ms as unknown as (value: unknown) => number | string | undefined;

/**
 * `"15m"` / `"1h"` / seconds as a number → seconds, or `undefined` when the
 * value cannot be parsed (the cache rejects such a TTL anyway).
 */
function durationSeconds(duration: string | number): number | undefined {
  if (typeof duration === "number") {
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  }

  let milliseconds: number | string | undefined;

  try {
    milliseconds = parseMs(duration);
  } catch {
    milliseconds = undefined;
  }

  return typeof milliseconds === "number" && Number.isFinite(milliseconds) && milliseconds > 0
    ? milliseconds / 1000
    : undefined;
}

/**
 * Built-in identifier extractor — reads the configured credential field from
 * the request body for the per-account key, and `request.detectIp()` for the
 * per-source key. Untruthy values are dropped; a request that yields zero
 * identifiers is left untracked so the middleware no-ops for it.
 */
function buildDefaultIdentifiers(
  request: Request,
  tracked: LoginThrottleIdentifier[],
  credentialField: string,
): string[] {
  const identifiers: string[] = [];

  if (tracked.includes("email")) {
    const value = request.input(credentialField);

    if (typeof value === "string" && value.trim().length > 0) {
      identifiers.push(`email.${throttleIdentifierHash("email", value)}`);
    }
  }

  if (tracked.includes("ip")) {
    const ip = request.detectIp();

    if (ip) {
      identifiers.push(`ip.${throttleIdentifierHash("ip", ip)}`);
    }
  }

  return identifiers;
}

/**
 * Failure-aware login throttle. Locks an identifier (account, IP, or both)
 * after too many failed login attempts within a window — without penalising
 * a user who eventually types the right password.
 *
 * Mechanism (per identifier):
 *
 * 1. **Before the controller** — reject with `429` if a lock key is set,
 *    skipping the DB lookup AND the bcrypt verify (this also neutralises the
 *    CPU-DoS angle of brute-forcing).
 * 2. **After the controller** — observe the outcome via `response.onSent`.
 *    On failure (non-2xx by default), bump a fixed-window counter; once it
 *    reaches `max`, set a lock key with `lockoutDuration` TTL. On success,
 *    clear both the counter and the lock for that identifier.
 *
 * Storage is `@warlock.js/cache` (a peer dependency of `@warlock.js/auth`,
 * transitively guaranteed via `@warlock.js/core`). Lockout state is shared
 * across replicas — correct security model, because an attacker can't bypass
 * by round-robin to a different pod. Every cache call is guarded so a
 * misconfigured driver fails open (a throttle outage must never escalate
 * into a full auth outage).
 *
 * @example
 * import { loginThrottleMiddleware } from "@warlock.js/auth";
 * import { router } from "@warlock.js/core";
 *
 * router.post("/auth/login", loginController, {
 *   middleware: [loginThrottleMiddleware({ max: 5, window: "15m" })],
 * });
 *
 * @example
 * // Per-IP only — avoid account-lockout-as-DoS on anonymous-attack vectors
 * router.post("/auth/refresh-token", refreshController, {
 *   middleware: [loginThrottleMiddleware({ by: ["ip"], max: 10, window: "1m" })],
 * });
 */
export function loginThrottleMiddleware(options: LoginThrottleOptions = {}): Middleware {
  const max = options.max ?? 5;
  const window = options.window ?? "15m";
  const lockoutDuration = options.lockoutDuration ?? "15m";
  const tracked = options.by ?? ["email", "ip"];
  const credentialField = options.identifierKey ?? "email";

  return async ({ request, response }) => {
    const identifiers = options.identify
      ? options.identify(request)
      : buildDefaultIdentifiers(request, tracked, credentialField);

    if (identifiers.length === 0) return;

    warnIfNullDriver();

    try {
      for (const identifier of identifiers) {
        const locked = isLocked(await cache.get(lockKey(identifier)));

        if (locked) {
          return response.tooManyRequests({
            error: options.errorMessage ?? t("auth.errors.tooManyAttempts"),
            errorCode: AuthErrorCodes.TooManyAttempts,
          });
        }
      }
    } catch (error) {
      // Fail open — a cache outage (driver not initialised, network blip)
      // must never escalate into a full auth outage. Log and let the request
      // through; the onSent recorder below is independently guarded so an
      // outage there is also harmless.
      log.error("auth", "login-throttle", error);

      return;
    }

    response.onSent(async (resolvedResponse: Response) => {
      try {
        const failed = options.isFailure
          ? options.isFailure(resolvedResponse)
          : !resolvedResponse.isOk;

        if (!failed) {
          for (const identifier of identifiers) {
            await cache.remove(counterKey(identifier));
            await cache.remove(lockKey(identifier));
          }

          return;
        }

        for (const identifier of identifiers) {
          const key = counterKey(identifier);

          // Open the window on the first failure: the create-only write means
          // only one of several racing servers sets the TTL, and an existing
          // window keeps its deadline (fixed window). The bump itself is an
          // atomic increment, so concurrent failures across servers are never
          // lost (redis INCRBY / pg upsert keep the window's TTL).
          await cache.set(key, 0, { ttl: window, onConflict: "create" });
          const count = await cache.increment(key);

          if (count >= max) {
            const lockSeconds = durationSeconds(lockoutDuration);

            // The lock stores its own deadline: a driver with sliding
            // expiration (`memoryExtended`) pushes the key's TTL forward on
            // every read, but the deadline in the value does not move, so a
            // client that keeps retrying is still released after
            // `lockoutDuration`.
            await cache.set(
              lockKey(identifier),
              lockSeconds === undefined ? true : Date.now() + lockSeconds * 1000,
              { ttl: lockoutDuration },
            );
          }
        }
      } catch (error) {
        log.error("auth", "login-throttle", error);
      }
    });
  };
}
