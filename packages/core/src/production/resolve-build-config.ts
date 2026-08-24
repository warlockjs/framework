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
 * esbuild options the build config may not carry, and why.
 *
 * Both apply the named compiler options to EVERY file in the bundle, not just
 * the app's own sources — workspace packages compiled under their own tsconfig
 * are silently recompiled under the app's. An app-level
 * `verbatimModuleSyntax: true` reaching package sources that never opted into
 * it strips the imports their decorators rely on, and the build succeeds only
 * to die at import time with `Class extends value undefined`.
 */
const FORBIDDEN_BUILD_OPTIONS = {
  tsconfig: "points esbuild at a tsconfig file",
  tsconfigRaw: "inlines compiler options",
} as const;

/**
 * Raised when the build config carries an esbuild option the framework owns.
 *
 * The typed config already omits these keys; this catches the forms the type
 * cannot see — an `as any` cast, or a plain `warlock.config.js`. Rejected
 * rather than deleted: dropping the key quietly would leave the author
 * believing a setting applied when it never did.
 */
export class ForbiddenBuildOptionError extends Error {
  public constructor(public readonly option: keyof typeof FORBIDDEN_BUILD_OPTIONS) {
    super(
      [
        `build.${option} is not a supported warlock build option.`,
        "",
        `Setting it ${FORBIDDEN_BUILD_OPTIONS[option]} for every file in the bundle,`,
        "including workspace packages that were compiled under their own tsconfig.",
        "Options such as `verbatimModuleSyntax` then apply to sources that never",
        "opted into them, and the build succeeds but crashes at import time with",
        "`Class extends value undefined`.",
        "",
        `Remove \`${option}\` from the \`build\` block of your warlock config. The builder`,
        "already reads the app's tsconfig for the parts it needs (path aliases); to",
        "change how your own sources compile, edit that tsconfig.json instead.",
      ].join("\n"),
    );

    this.name = "ForbiddenBuildOptionError";
  }
}

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

  // Before the merge, so the option cannot reach the esbuild spread in
  // production-builder — which overrides framework defaults with user config.
  for (const option of Object.keys(FORBIDDEN_BUILD_OPTIONS) as Array<
    keyof typeof FORBIDDEN_BUILD_OPTIONS
  >) {
    if (option in userBuild) {
      throw new ForbiddenBuildOptionError(option);
    }
  }

  const defaults = defaultWarlockConfigurations.build!;
  const merged = { ...defaults, ...userBuild } as ResolvedBuildConfig;

  return {
    ...merged,
    entryPath: path.resolve(merged.outdir, merged.outFile),
  };
}
