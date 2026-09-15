import { createHash } from "node:crypto";
import type { Request } from "../../request";

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
 * Idempotency middleware must run **after** `authMiddleware` so
 * `request.locals.user` (written by `@warlock.js/auth`) and
 * `request.decodedAccessToken` are populated.
 *
 * @example
 * buildIdempotencyCacheKey(request, "01J9XZQ-ABC"); // "idem:client:user_123:01J9XZQ-ABC"
 */
/**
 * Read `id` off `request.locals.user` without assuming any app's
 * `RequestUser` augmentation (declared by `@warlock.js/auth`, which core
 * cannot import) declares it, and without assuming `@warlock.js/auth` is
 * even installed — hence the untyped `unknown` read here rather than a
 * typed `RequestLocals["user"]` access.
 *
 * A local, narrow runtime read survives any augmentation shape (eed20184
 * step (b) — `implementation/2026-08-20-A2-request-locals.md` §6.2) — no
 * `as any`.
 */
function readUserId(user: unknown): string | number | undefined {
  if (!user || typeof user !== "object" || !("id" in user)) return undefined;

  const id = (user as { id?: unknown }).id;

  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

export function buildIdempotencyCacheKey(request: Request, idempotencyKey: string): string {
  const userType = request.decodedAccessToken?.userType || "anonymous";
  const locals = request.locals as Record<string, unknown>;
  const userId = readUserId(locals.user) || request.detectIp() || "unknown";

  return `idem:${userType}:${userId}:${idempotencyKey}`;
}
