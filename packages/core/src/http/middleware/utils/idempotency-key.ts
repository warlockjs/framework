import { createHash } from "node:crypto";
import type { Request } from "../../request";
import type { RequestUser } from "../../types";

/**
 * Idempotency-key validation rules.
 *
 * RFC draft-ietf-httpapi-idempotency-key suggests UUIDs or ULIDs but doesn't
 * mandate a format. We accept any printable ASCII string up to 255 chars —
 * tight enough to reject log-injection (no control characters / newlines),
 * loose enough to accept whatever ID scheme the client picks.
 */
const MAX_KEY_LENGTH = 255;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_KEY_LENGTH &&
    PRINTABLE_ASCII.test(value)
  );
}

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
export function hashBody(body: unknown): string {
  const serialized = typeof body === "string" ? body : JSON.stringify(body ?? {});

  return createHash("sha256").update(serialized).digest("hex");
}

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
/**
 * Read `id` off `request.user` without assuming every app's `RequestUser`
 * augmentation declares it.
 *
 * `RequestUser` (`core/src/http/types.ts`) is empty by default — apps narrow
 * it to their own model shape. Adding `id` directly to `RequestUser` here
 * would force that exact field (and type) onto every app: TypeScript
 * interface merging requires all declarations of a shared member to have an
 * identical type, so an app augmenting `RequestUser` with, say, `id: string`
 * only would conflict with a core-declared `id?: string | number`. A local,
 * narrow read survives any augmentation shape (eed20184 step (b) —
 * `implementation/2026-08-20-A2-request-locals.md` §6.2) — no `as any`.
 */
function readUserId(user: RequestUser | undefined): string | number | undefined {
  if (!user || typeof user !== "object" || !("id" in user)) return undefined;

  const id = (user as { id?: unknown }).id;

  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

export function buildIdempotencyCacheKey(request: Request, idempotencyKey: string): string {
  const userType = request.decodedAccessToken?.userType || "anonymous";
  const userId = readUserId(request.user) || request.detectIp() || "unknown";

  return `idem:${userType}:${userId}:${idempotencyKey}`;
}
