import esbuild from "esbuild";
import { EsbuildBinaryMissingError } from "../errors/esbuild-binary-missing-error";

export { EsbuildBinaryMissingError };

/**
 * The exact substring esbuild's own loader throws when the platform-specific
 * binary package (e.g. `@esbuild/win32-x64`) never got installed. This is
 * the signature pnpm's build-script approval gate leaves behind: it blocks
 * esbuild's postinstall script, so the binary is never linked into place,
 * and any later call into esbuild dies with this message instead of a
 * project-shaped one.
 *
 * Source: `pkgAndSubpathForCurrentPlatform` in esbuild's `lib/main.js`.
 */
const UNLINKED_BINARY_SIGNATURE = "could not be found, and is needed by esbuild";

/**
 * A cheap operation that forces esbuild to resolve and invoke its platform
 * binary. Injectable so tests can simulate a missing binary without deleting
 * anything from a real install.
 */
export type EsbuildProbe = () => void;

/**
 * The default probe: a trivial `transformSync` call. Trivial input keeps the
 * cost negligible while still forcing esbuild to resolve and run its native
 * binary, which is the only way an unlinked binary actually surfaces.
 */
function runDefaultProbe(): void {
  esbuild.transformSync("", { loader: "js" });
}

/**
 * Fail fast, before dev or build does any other work, when esbuild's native
 * binary is not linked.
 *
 * A healthy esbuild install is a no-op. A binary genuinely missing — because
 * a platform package was never installed, or a package manager blocked its
 * postinstall script — is turned into {@link EsbuildBinaryMissingError}, a
 * message that names the cause and the fix. Any other failure (a real syntax
 * error, an unrelated platform mismatch, …) is rethrown unchanged — this
 * preflight only owns the one known failure mode.
 *
 * @param probe Overrides the default `esbuild.transformSync` invocation.
 * Intended for tests only.
 * @throws {EsbuildBinaryMissingError} when the platform binary is missing or unlinked.
 */
export function assertEsbuildBinaryIsLinked(probe: EsbuildProbe = runDefaultProbe): void {
  try {
    probe();
  } catch (error) {
    if (isUnlinkedBinaryError(error)) {
      throw new EsbuildBinaryMissingError({ cause: error });
    }

    throw error;
  }
}

/**
 * Narrow an unknown thrown value down to esbuild's known "binary not
 * linked" failure, identified by the fixed substring esbuild itself throws.
 */
function isUnlinkedBinaryError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(UNLINKED_BINARY_SIGNATURE);
}
