import type { AIError } from "@warlock.js/ai";

/**
 * Read the `cause` off an {@link AIError} as an `unknown` for assertions.
 *
 * `AIError` populates `cause` at runtime (from its options) but does not
 * expose it as a typed field, and `Error.cause` is absent from the
 * `ES2020` lib this package compiles against. Tests need the original
 * wrapped error (a `WorkspacePolicyError` / `WorkspaceEditError` surfaced
 * as the `ToolExecutionError`'s cause), so this reads the property through
 * a precise structural view — never `any` — keeping the assertion typed at
 * the `unknown` boundary, where the test then `instanceof`-narrows it.
 *
 * Test-only helper; not part of the package's public surface.
 *
 * @example
 * expect(causeOf(result.error)).toBeInstanceOf(WorkspaceEditError);
 */
export function causeOf(error: AIError | undefined): unknown {
  return (error as { cause?: unknown } | undefined)?.cause;
}
