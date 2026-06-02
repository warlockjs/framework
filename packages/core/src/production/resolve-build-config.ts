import path from "path";
import { defaultWarlockConfigurations } from "../warlock-config/default-configurations";
import type { WarlockConfig } from "../warlock-config/types";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";

export type ResolvedBuildConfig = Required<NonNullable<WarlockConfig["build"]>> & {
  /** Absolute path to the bundled entry file (`{outDirectory}/{outFile}`) */
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
  const userBuild = warlockConfigManager.get("build") ?? {};
  const defaults = defaultWarlockConfigurations.build!;
  const merged = { ...defaults, ...userBuild } as Required<NonNullable<WarlockConfig["build"]>>;

  return {
    ...merged,
    entryPath: path.resolve(merged.outDirectory, merged.outFile),
  };
}
