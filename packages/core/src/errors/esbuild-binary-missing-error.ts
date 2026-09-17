/**
 * Raised when `warlock dev` / `warlock build` cannot use esbuild because its
 * platform-native binary was never installed or linked.
 *
 * The message names what is missing and the exact fix — reinstall with the
 * package manager without skipping install scripts — so the failure is
 * actionable at the point it is thrown, instead of surfacing later as an
 * opaque low-level error from deep inside the bundler.
 */
export class EsbuildBinaryMissingError extends Error {
  public constructor(options?: { cause?: unknown }) {
    super(
      "esbuild's native binary is not installed or linked for this platform, so " +
        "`warlock dev` / `warlock build` cannot run.\n\n" +
        "This usually happens when a platform package such as `@esbuild/win32-x64` " +
        "was never installed, or the package manager skipped esbuild's postinstall " +
        "script that links it. Fix it with:\n\n" +
        "  pnpm approve-builds\n\n" +
        "then reinstall dependencies (do not skip install scripts), " +
        "or reinstall with your package manager's equivalent of allowing build scripts.",
      options,
    );

    this.name = "EsbuildBinaryMissingError";
  }
}
