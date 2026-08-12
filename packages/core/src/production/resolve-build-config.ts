import path from "path";
import { defaultWarlockConfigurations } from "../warlock-config/default-configurations";
import { normalizeBuildConfig } from "../warlock-config/normalize-build-config";
import type { WarlockConfig } from "../warlock-config/types";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";

/**
 * Keys the builder deletes before handing the options to esbuild — ours
 * (`singleBundle`, `esmShim`), which esbuild would reject as unknown, and
 * `banner`, which is re-merged and re-applied after the user spread.
 *
 * They are optional here for a concrete reason: `Required<…>` makes `delete`
 * a type error (TS2790). Naming exactly these three says which keys are
 * removable, rather than casting at each `delete` — a cast there would also
 * hide a genuine mistake.
 *
 * `outFile` and `entryPath` stay REQUIRED even though the builder deletes
 * them too. They are always present after resolution and callers depend on
 * that; widening them to `string | undefined` pushed the lie downstream into
 * `start-production.command.ts`, which then could not trust its own config.
 */
type BuilderStrippedKeys = "singleBundle" | "esmShim" | "banner";

export type ResolvedBuildConfig = Required<
  Omit<NonNullable<WarlockConfig["build"]>, "outDirectory" | BuilderStrippedKeys>
> &
  Partial<Pick<NonNullable<WarlockConfig["build"]>, BuilderStrippedKeys>> & {
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
