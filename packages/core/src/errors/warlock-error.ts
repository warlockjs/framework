import type { WarlockErrorCode } from "./error-codes";

/**
 * A framework error with a stable {@link WarlockErrorCode}.
 *
 * Thrown where core used to throw a bare `Error`, so the failure can be looked
 * up (`warlock explain <code>`) instead of matched by message. Still an
 * `Error`: existing `catch` blocks and message assertions keep working.
 *
 * @example
 * throw new WarlockError("WL3003", `Route name "${name}" not found`);
 */
export class WarlockError extends Error {
  /** Stable Warlock error code; `warlock explain <code>` prints the fix. */
  public readonly code: WarlockErrorCode;

  public constructor(code: WarlockErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WarlockError";
    this.code = code;
  }
}
