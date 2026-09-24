import config from "@mongez/config";
import { cache } from "@warlock.js/cache";
import { log } from "@warlock.js/logger";
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
};

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

    const cacheDriver = driverName ? await cache.use(driverName) : cache;
    const cacheKey = buildIdempotencyCacheKey(request, idempotencyKey);
    const bodyHash = hashBody(request.body);

    // Reserve the key atomically before the handler runs, so concurrent
    // requests with the same key can't both execute it.
    const reservation = (await cacheDriver.set(
      cacheKey,
      { state: "in-flight", startedAt: Date.now() } satisfies InFlightReservation,
      { onConflict: "create", ttl: reservationTtl },
    )) as { wasSet: boolean; existing?: CachedResponse | InFlightReservation } | undefined;

    if (reservation && !reservation.wasSet) {
      const existing = reservation.existing;

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
    }

    response.onSent((sentResponse: Response) => {
      // Don't cache server errors — clients should be able to retry past a 5xx.
      // 4xx are deterministic outcomes of the request, so caching is fine.
      // Free the reservation so a retry can run.
      if (sentResponse.statusCode >= 500) {
        cacheDriver.remove(cacheKey).catch((error: unknown) => {
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
