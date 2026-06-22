/**
 * Shared test-only helpers for `@warlock.js/ai-tools` specs.
 *
 * Imported only by `*.spec.ts` files; never part of the package's public
 * surface.
 */

/**
 * Read the `cause` off an unknown error value through a precise structural
 * view. `Error.cause` is absent from the ES2020 lib and `AIError` does not
 * re-declare it, so a direct `error.cause` access fails to typecheck. This
 * helper reads it without `any` or `@ts-ignore`.
 */
export function causeOf(error: unknown): unknown {
  return (error as { cause?: unknown }).cause;
}
