import config from "@mongez/config";
import { cache } from "@warlock.js/cache";
import type { Middleware } from "../../router";
import { HttpErrorCodes } from "../error-codes";
import type { Response } from "../response";
import { t } from "./inject-request-context";
import {
  buildIdempotencyCacheKey,
  hashBody,
  isValidIdempotencyKey,
} from "./utils/idempotency-key";

/**
 * Options for the idempotency middleware.
 */
export type IdempotencyOptions = {
  /**
   * Cache TTL in seconds. Falls back to `http.idempotency.ttl`, then `86400` (24h).
   */
  ttl?: number;
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
  return async (request, response) => {
    const headerName =
      options.headerName ||
      config.get("http.idempotency.headerName", "Idempotency-Key");
    const methods =
      options.methods || config.get("http.idempotency.methods", DEFAULT_METHODS);
    const ttl = options.ttl || config.get("http.idempotency.ttl", 86400);
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

    const cached = (await cacheDriver.get(cacheKey)) as CachedResponse | null;

    if (cached) {
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
      if (sentResponse.statusCode >= 500) return;

      const sentContentType = sentResponse.contentType;

      cacheDriver.set(
        cacheKey,
        {
          status: sentResponse.statusCode,
          body: sentResponse.parsedBody,
          bodyHash,
          contentType: typeof sentContentType === "string" ? sentContentType : undefined,
        },
        ttl,
      );
    });
  };
}
