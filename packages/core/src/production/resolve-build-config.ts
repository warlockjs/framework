import path from "path";
import { defaultWarlockConfigurations } from "../warlock-config/default-configurations";
import { normalizeBuildConfig } from "../warlock-config/normalize-build-config";
import type { WarlockConfig } from "../warlock-config/types";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";

export type ResolvedBuildConfig = Required<
  Omit<NonNullable<WarlockConfig["build"]>, "outDirectory">
> & {
  /** Absolute path to the bundled entry file (`{outdir}/{outFile}`) */
  entryPath: string;
};

/**
 * Resolve the build config with framework defaults applied.
 *
 * Both the production builder and `warlock start` call this so they
 * agree on where the bundle lives — previously each had its own local
 * fallbacks and they drifted (`.warlock/production` vs `dist`),
 * letting `build` and `start` look at different paths.
 */
export function resolveBuildConfig(): ResolvedBuildConfig {
  // Normalised here rather than only in `defineConfig` because a project may
  // export a plain config object that never went through it.
  const userBuild = normalizeBuildConfig(warlockConfigManager.get("build") ?? {});
  const defaults = defaultWarlockConfigurations.build!;
  const merged = { ...defaults, ...userBuild } as ResolvedBuildConfig;

  return {
    ...merged,
    entryPath: path.resolve(merged.outdir, merged.outFile),
  };
}
