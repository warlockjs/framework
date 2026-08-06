import type { WarlockConfig } from "./types";

type BuildConfig = NonNullable<WarlockConfig["build"]>;

/**
 * Fold the `outDirectory` alias into the canonical `outdir`.
 *
 * `outDirectory` is the name the documentation used for several releases
 * while the code only ever read `outdir`, so a config written from the docs
 * was silently ignored and the bundle still landed in `dist/`. Accepting both
 * keeps those configs working; `outdir` wins when both are set, since that is
 * the name esbuild uses and the one we tell people to prefer.
 *
 * Returns the input untouched when there is nothing to fold, so the common
 * case allocates nothing.
 */
export function normalizeBuildConfig<T extends BuildConfig>(build: T): T {
  if (!build.outDirectory || build.outdir) {
    return build;
  }

  return { ...build, outdir: build.outDirectory };
}
