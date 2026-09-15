import esbuild from "esbuild";

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
 * Fail fast, before bundling, when esbuild's native binary is not linked.
 *
 * Runs a single trivial `transformSync` call — the cheapest operation that
 * forces esbuild to resolve its platform binary — so it adds no measurable
 * delay to `warlock build`. Only called from the production build path;
 * never from `warlock dev`.
 *
 * A healthy esbuild install is a no-op. A binary genuinely missing because
 * pnpm blocked its postinstall script is turned into a message that names
 * the cause and the fix. Any other failure (a real syntax error, a platform
 * mismatch, …) is rethrown unchanged — this preflight only owns the one
 * known failure mode.
 */
export function assertEsbuildBinaryIsLinked(): void {
  try {
    esbuild.transformSync("", { loader: "js" });
  } catch (error) {
    if (isUnlinkedBinaryError(error)) {
      throw new Error(
        "esbuild's native binary is not installed for this platform, so " +
          "`warlock build` cannot bundle.\n\n" +
          "This usually happens when pnpm's build-script approval gate " +
          "blocked esbuild's postinstall script, so the platform binary " +
          "was never linked. Fix it with:\n\n" +
          "  pnpm approve-builds\n\n" +
          "then reinstall, or reinstall dependencies with build scripts " +
          "enabled if esbuild was excluded on purpose.",
      );
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
