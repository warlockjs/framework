import { Request } from "../../request.mjs";

//#region ../../@warlock.js/core/src/http/middleware/utils/idempotency-key.d.ts
declare function isValidIdempotencyKey(value: unknown): value is string;
/**
 * Hash a request body to a stable hex digest.
 *
 * Used to detect "same key, different body" — that's a client bug, not a retry.
 * sha256 is overkill for collision resistance here, but it's the dependency-free
 * choice and avoids importing a faster hasher.
 *
 * @example
 * hashBody({ amount: 100, currency: "USD" }); // "a1b2c3..."
 */
declare function hashBody(body: unknown): string;
/**
 * Build the cache key for an idempotency record.
 *
 * Scope is `userType:userId` when authenticated, falling back to the client IP
 * when anonymous. This prevents user A from replaying user B's key — even if
 * user B used a guessable value — while still letting the primitive work on
 * public endpoints.
 *
 * Idempotency middleware must run **after** `authMiddleware` so `request.user`
 * and `request.decodedAccessToken` are populated.
 *
 * @example
 * buildIdempotencyCacheKey(request, "01J9XZQ-ABC"); // "idem:client:user_123:01J9XZQ-ABC"
 */
declare function buildIdempotencyCacheKey(request: Request, idempotencyKey: string): string;
//#endregion
export { buildIdempotencyCacheKey, hashBody, isValidIdempotencyKey };
//# sourceMappingURL=idempotency-key.d.mts.map