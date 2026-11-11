import { createHash, createHmac } from "node:crypto";
import { cache } from "@warlock.js/cache";
import { t, type Middleware, type Request, type Response } from "@warlock.js/core";
import { log } from "@warlock.js/logger";
import ms from "ms";
import { authConfig } from "../services/auth-config";
import { AuthErrorCodes } from "../utils/auth-error-codes";
import { normalizeEmailIdentifier } from "../utils/normalize-credentials";

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
 * Failure-aware by design: every attempt is counted when it arrives (so a
 * burst of concurrent requests cannot outrun the limit), and a successful
 * response (2xx, or whatever `isFailure` says) resets the count, so a user who
 * types a wrong password three times then the right one is not penalised.
 *
 * @example
 * loginThrottleMiddleware({ max: 5, window: "15m", lockoutDuration: "15m" });
 */
export type LoginThrottleOptions = {
  /**
   * Failures allowed within the window before the identifier is locked. It
   * also caps how many attempts may be in flight at once: a request beyond it
   * is refused with `429` before the controller runs.
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
   * Who an account lock applies to when both `"email"` and `"ip"` are tracked.
   *
   * - `"global"` — `max` failures for an email, from any source, lock that
   *   email for everyone (the account owner included).
   * - `"pair"` — the `max` lock applies to the (email, source IP) pair, so a
   *   stranger guessing from their own IP cannot lock the owner out. The email
   *   alone keeps a wider bucket (`accountMax`) that still stops guessing
   *   spread across many IPs.
   *
   * Ignored when `identify` is set or `by` does not track both.
   *
   * @default "global"
   */
  emailLock?: "pair" | "global";

  /**
   * Attempts one email may take from all sources together within the window
   * before it is locked, when `emailLock` is `"pair"`.
   *
   * @default max * 10
   */
  accountMax?: number;

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
  const normalized = `${kind}:${normalizeEmailIdentifier(value)}`;
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
  max: number,
  pair: { accountMax: number } | undefined,
): TrackedIdentifier[] {
  const identifiers: TrackedIdentifier[] = [];
  const value = tracked.includes("email") ? request.input(credentialField) : undefined;
  const email = typeof value === "string" && value.trim().length > 0 ? value : undefined;
  const ip = tracked.includes("ip") ? request.detectIp() : undefined;

  if (email !== undefined) {
    if (pair && ip) {
      // The hard lock belongs to this source only; the email-wide bucket is
      // wider, so a stranger cannot lock the owner out with `max` guesses.
      const pairValue = `${normalizeEmailIdentifier(email)}|${ip}`;

      identifiers.push({ key: `email-ip.${throttleIdentifierHash("email-ip", pairValue)}`, max });
      identifiers.push({
        key: `email.${throttleIdentifierHash("email", email)}`,
        max: pair.accountMax,
      });
    } else {
      identifiers.push({ key: `email.${throttleIdentifierHash("email", email)}`, max });
    }
  }

  if (ip) {
    identifiers.push({ key: `ip.${throttleIdentifierHash("ip", ip)}`, max });
  }

  return identifiers;
}

/** One throttle bucket: its cache-key suffix and the attempts it allows. */
type TrackedIdentifier = { key: string; max: number };

/**
 * Failure-aware login throttle. Locks an identifier (account, IP, or both)
 * after too many failed login attempts within a window — without penalising
 * a user who eventually types the right password.
 *
 * Mechanism (per identifier):
 *
 * 1. **Before the controller** — reject with `429` if a lock key is set,
 *    skipping the DB lookup AND the bcrypt verify (this also neutralises the
 *    CPU-DoS angle of brute-forcing). Otherwise count the attempt in a
 *    fixed-window counter right away, and reject with `429` (setting the lock)
 *    when it goes past `max`. Counting at entry is what bounds a burst of
 *    concurrent requests: at most `max` attempts per window reach the
 *    controller, however many arrive at once.
 * 2. **After the controller** — observe the outcome via `response.onSent`.
 *    On failure (non-2xx by default), set a lock key with `lockoutDuration`
 *    TTL once the attempt count has reached `max`. On success, clear both the
 *    counter and the lock for that identifier.
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
  const pair =
    options.emailLock === "pair" && tracked.includes("email") && tracked.includes("ip")
      ? { accountMax: options.accountMax ?? max * 10 }
      : undefined;

  /**
   * Lock an identifier for `lockoutDuration`. The counter is rewritten with
   * the same TTL, so the two expire together and the identifier starts a fresh
   * window once the lockout ends. Rewriting keeps a value of at least `count`,
   * so a request that slipped past the lock check still sees "over the limit".
   */
  const lock = async (identifier: string, count: number): Promise<void> => {
    const lockSeconds = durationSeconds(lockoutDuration);

    // The lock stores its own deadline: a driver with sliding expiration
    // (`memoryExtended`) pushes the key's TTL forward on every read, but the
    // deadline in the value does not move, so a client that keeps retrying is
    // still released after `lockoutDuration`.
    await cache.set(
      lockKey(identifier),
      lockSeconds === undefined ? true : Date.now() + lockSeconds * 1000,
      { ttl: lockoutDuration },
    );
    await cache.set(counterKey(identifier), count, { ttl: lockoutDuration });
  };

  return async ({ request, response }) => {
    const identifiers: TrackedIdentifier[] = options.identify
      ? options.identify(request).map((key) => ({ key, max }))
      : buildDefaultIdentifiers(request, tracked, credentialField, max, pair);

    if (identifiers.length === 0) return;

    warnIfNullDriver();

    const tooManyRequests = () =>
      response.tooManyRequests({
        error: options.errorMessage ?? t("auth.errors.tooManyAttempts"),
        errorCode: AuthErrorCodes.TooManyAttempts,
      });

    /** The attempt number this request took in each identifier's window. */
    const counts = new Map<string, number>();

    try {
      for (const identifier of identifiers) {
        if (isLocked(await cache.get(lockKey(identifier.key)))) {
          return tooManyRequests();
        }
      }

      for (const identifier of identifiers) {
        const key = counterKey(identifier.key);

        // Open the window on the first attempt: the create-only write means
        // only one of several racing servers sets the TTL, and an existing
        // window keeps its deadline (fixed window). The bump itself is an
        // atomic increment, so concurrent attempts across servers are never
        // lost (redis INCRBY / pg upsert keep the window's TTL). Passing the
        // TTL on the bump also expires a key recreated after the seed.
        await cache.set(key, 0, { ttl: window, onConflict: "create" });
        const count = await cache.increment(key, 1, { ttl: window });

        if (typeof count !== "number" || !Number.isFinite(count)) continue;

        counts.set(identifier.key, count);

        if (count > identifier.max) {
          if (count === identifier.max + 1) {
            await lock(identifier.key, count);
          }

          return tooManyRequests();
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
            await cache.remove(counterKey(identifier.key));
            await cache.remove(lockKey(identifier.key));
          }

          return;
        }

        // Already counted at entry; a failure that used the last allowed
        // attempt starts the lockout, unless a success that finished while it
        // ran already reset the window (a correct login racing a mistyped one
        // must not lock the account it just signed in to).
        for (const identifier of identifiers) {
          const count = counts.get(identifier.key);

          if (count === undefined || count < identifier.max) continue;

          const current = Number((await cache.get(counterKey(identifier.key))) ?? 0);

          if (Number.isFinite(current) && current < count) continue;

          await lock(identifier.key, count);
        }
      } catch (error) {
        log.error("auth", "login-throttle", error);
      }
    });
  };
}
