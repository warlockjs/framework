import { merge } from "@mongez/reinforcements";
import { defaultWarlockConfigurations } from "./default-configurations";
import { normalizeBuildConfig } from "./normalize-build-config";
import type { WarlockConfig } from "./types";

export function defineConfig(options: WarlockConfig) {
  // Fold `build.outDirectory` into `build.outdir` BEFORE merging. Afterwards
  // is too late: the defaults supply an `outdir`, so the alias could never
  // tell "the user set outdir" from "the default did" and would be dropped.
  const normalized: WarlockConfig = options.build
    ? { ...options, build: normalizeBuildConfig(options.build) }
    : options;

  return merge(defaultWarlockConfigurations, normalized) as WarlockConfig;
}
