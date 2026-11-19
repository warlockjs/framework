import config from "@mongez/config";
import { cache } from "@warlock.js/cache";
import { log } from "@warlock.js/logger";
import type { Request } from "../request";
import type { Middleware } from "../../router";
import { HttpErrorCodes } from "../error-codes";
import type { Response } from "../response";
import { t } from "./inject-request-context";
import { buildIdempotencyCacheKey, hashBody, isValidIdempotencyKey } from "./utils/idempotency-key";

/**
 * Options for the idempotency middleware.
 */
export type IdempotencyOptions = {
  /**
   * Cache TTL in seconds. Falls back to `http.idempotency.ttl`, then `86400` (24h).
   */
  ttl?: number;
  /**
   * TTL in seconds of the in-flight reservation held while the handler runs.
   * Falls back to `http.idempotency.reservationTtl`, then `60`.
   */
  reservationTtl?: number;
  /**
   * Header name carrying the client's key. Falls back to
   * `http.idempotency.headerName`, then `"Idempotency-Key"`.
   */
  headerName?: string;
  /**
   * HTTP methods eligible for idempotency. Falls back to
   * `http.idempotency.methods`, then `["POST","PUT","PATCH","DELETE"]`.
   * Safe methods (GET/HEAD) are skipped regardless.
   */
  methods?: string[];
  /**
   * Cache driver name. Falls back to `http.idempotency.driver`, then the
   * default driver of the cache manager.
   */
  driver?: string;
  /**
   * A durable store to keep the records in, instead of the cache. Use it when a
   * record must survive a restart or be shared by every server, for example a
   * table in the app's database. Takes precedence over `driver`.
   *
   * `reserve` must be atomic: of two concurrent calls with the same key, exactly one
   * gets `wasSet: true`.
   */
  store?: IdempotencyStore;
  /**
   * Narrow the key beyond the user and the route, for example to a tenant or an
   * organisation: `scope: (request) => request.header("x-tenant")`. Returning
   * `undefined` or an empty string adds nothing to the key.
   */
  scope?: (request: Request) => string | undefined | Promise<string | undefined>;
};

/**
 * The storage an idempotency record needs. A cache driver satisfies it through the
 * default adapter; implement it to keep records somewhere durable.
 */
export type IdempotencyStore = {
  /** Read the record under a key, `null` or `undefined` when there is none. */
  get(key: string): Promise<unknown>;
  /** Create the record only when the key is free. `existing` is the record that blocked it. */
  reserve(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<{ wasSet: boolean; existing?: unknown }>;
  /** Replace the record with the final response. */
  set(key: string, value: unknown, ttlSeconds: number): Promise<unknown>;
  /** Delete the record. */
  remove(key: string): Promise<unknown>;
};

type CacheLike = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options?: any): Promise<unknown>;
  remove(key: string): Promise<unknown>;
};

function storeFromCache(driver: CacheLike): IdempotencyStore {
  return {
    get: (key) => driver.get(key),
    async reserve(key, value, ttlSeconds) {
      const result = (await driver.set(key, value, { onConflict: "create", ttl: ttlSeconds })) as
        | { wasSet?: boolean; existing?: unknown }
        | undefined;

      // a driver that does not report the outcome is treated as "reserved"
      return { wasSet: result?.wasSet !== false, existing: result?.existing };
    },
    set: (key, value, ttlSeconds) => driver.set(key, value, ttlSeconds),
    remove: (key) => driver.remove(key),
  };
}

type CachedResponse = {
  status: number;
  body: unknown;
  bodyHash: string;
  contentType?: string;
};

type InFlightReservation = {
  state: "in-flight";
  startedAt: number;
};

const DEFAULT_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Dedupe non-idempotent writes by an `Idempotency-Key` header — same key,
 * same body, within TTL → cached replay; same key, different body → 422
 * `IdempotencyKeyConflict`.
 *
 * **Must run after `authMiddleware`** — the cache key is scoped per-user
 * (`idem:{userType}:{userId}:{key}`) so user A can't replay user B's key.
 * Anonymous requests fall back to IP scope.
 *
 * Guarantees, precisely:
 * - **Storage.** Records live in the app cache (the default driver of the cache
 *   manager, or `driver`). With the default in-memory driver they are per process:
 *   lost on restart and invisible to other servers. Pass `store` (or a shared cache
 *   driver such as Redis) when a record must survive a restart or be shared.
 * - **Claim before the handler.** The key is reserved create-only before the handler
 *   runs (`reservationTtl`), so a concurrent duplicate gets 409 instead of running twice.
 * - **Write timing.** The final response is stored after it is sent. A crash between
 *   the send and that write leaves only the reservation, which expires after
 *   `reservationTtl`; a retry after that runs the handler again.
 * - **Cache down.** The middleware fails open: the handler runs and the error is logged.
 *   For money-moving writes, claim the key inside the transaction as well.
 * - **Statuses.** 2xx, 3xx and 4xx are stored and replayed (a replayed 4xx is the answer
 *   the first request got, even if the data changed since). 5xx frees the key so a retry can run.
 * - **Scope.** The key is scoped by user type, user id (IP when anonymous), method, route
 *   pattern and the concrete params/query. Add `scope` to narrow it further.
 *
 * The replay sets `Idempotent-Replay: true` on the response for easy
 * client-side / observability detection.
 *
 * Eligible methods default to POST/PUT/PATCH/DELETE. GET/HEAD pass through
 * even with the header set (RFC: safe methods are already idempotent).
 *
 * @example
 * import { authMiddleware } from "@warlock.js/auth";
 * import { middleware } from "@warlock.js/core";
 *
 * router.post("/orders", createOrderController, {
 *   middleware: [authMiddleware("client"), middleware.idempotency()],
 * });
 *
 * router.post("/ai/summarize", summarizeController, {
 *   middleware: [
 *     authMiddleware("client"),
 *     middleware.idempotency({ ttl: 60 * 60 }), // 1h is enough for client retries
 *   ],
 * });
 */
export function idempotencyMiddleware(options: IdempotencyOptions = {}): Middleware {
  return async ({ request, response }) => {
    const headerName =
      options.headerName || config.get("http.idempotency.headerName", "Idempotency-Key");
    const methods = options.methods || config.get("http.idempotency.methods", DEFAULT_METHODS);
    const ttl = options.ttl || config.get("http.idempotency.ttl", 86400);
    const reservationTtl =
      options.reservationTtl || config.get("http.idempotency.reservationTtl", 60);
    const driverName = options.driver || config.get("http.idempotency.driver");

    if (!methods.includes(request.method.toUpperCase())) return;

    const idempotencyKey = request.header(headerName.toLowerCase());

    if (!idempotencyKey) return;

    if (!isValidIdempotencyKey(idempotencyKey)) {
      return response.badRequest({
        error: t("http.idempotencyKeyInvalid"),
        errorCode: HttpErrorCodes.IdempotencyKeyInvalid,
      });
    }

    const cacheDriver: IdempotencyStore =
      options.store ?? storeFromCache(driverName ? await cache.use(driverName) : cache);
    const scope = options.scope ? await options.scope(request) : undefined;
    const cacheKey = buildIdempotencyCacheKey(request, idempotencyKey, scope);
    const bodyHash = hashBody(request.body);

    const respondToExisting = (
      existing: CachedResponse | InFlightReservation | undefined | null,
    ) => {
      if (!existing || (existing as InFlightReservation).state === "in-flight") {
        response.header("Retry-After", "1");

        return response.conflict({
          error: "A request with this Idempotency-Key is already in progress",
          errorCode: HttpErrorCodes.IdempotencyKeyConflict,
        });
      }

      const cached = existing as CachedResponse;

      if (cached.bodyHash !== bodyHash) {
        return response.unprocessableEntity({
          error: t("http.idempotencyKeyConflict"),
          errorCode: HttpErrorCodes.IdempotencyKeyConflict,
        });
      }

      response.header("Idempotent-Replay", "true");

      return response.replay({
        status: cached.status,
        body: cached.body,
        contentType: cached.contentType,
      });
    };

    // Fast path: a finished (or in-flight) request is already recorded.
    let existing: CachedResponse | InFlightReservation | null = null;

    try {
      existing = (await cacheDriver.get(cacheKey)) as CachedResponse | InFlightReservation | null;
    } catch (error) {
      // The cache is an optimisation of idempotency, not a gate on writes:
      // when it is down, fail open (the handler runs) and log it.
      log.error("idempotency-middleware", "get", error);
    }

    if (existing) return respondToExisting(existing);

    // Reserve the key atomically before the handler runs, so concurrent
    // requests with the same key can't both execute it.
    try {
      const reservation = await cacheDriver.reserve(
        cacheKey,
        { state: "in-flight", startedAt: Date.now() } satisfies InFlightReservation,
        reservationTtl,
      );

      if (reservation.wasSet === false) {
        return respondToExisting(
          reservation.existing as CachedResponse | InFlightReservation | undefined,
        );
      }
    } catch (error) {
      log.error("idempotency-middleware", "reserve", error);
    }

    response.onSent((sentResponse: Response) => {
      // Don't cache server errors — clients should be able to retry past a 5xx.
      // 4xx are deterministic outcomes of the request, so caching is fine.
      // Free the reservation so a retry can run.
      if (sentResponse.statusCode >= 500) {
        // Wrapped so a synchronous throw is caught as well as a rejection.
        Promise.resolve()
          .then(() => cacheDriver.remove(cacheKey))
          .catch((error: unknown) => {
            log.error("idempotency-middleware", "remove", error);
          });

        return;
      }

      const sentContentType = sentResponse.contentType;

      // `set` is fire-and-forget inside `onSent`; without a `.catch` a rejected
      // write (e.g. Redis down) would surface as an unhandledRejection.
      cacheDriver
        .set(
          cacheKey,
          {
            status: sentResponse.statusCode,
            body: sentResponse.parsedBody,
            bodyHash,
            contentType: typeof sentContentType === "string" ? sentContentType : undefined,
          },
          ttl,
        )
        .catch((error: unknown) => {
          log.error("idempotency-middleware", "set", error);
        });
    });
  };
}
