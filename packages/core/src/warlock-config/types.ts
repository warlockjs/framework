import type { MigrationConstructor } from "@warlock.js/cascade";
import type { CLICommand } from "../commands/cli-command";
import type { Connector } from "../connectors/types";
import type { FileHealthCheckerContract } from "../dev-server/health-checker/file-health-checker.contract";
import { type BuildOptions } from "esbuild";

/**
 * Resolved Warlock Configuration
 *
 * This is the final configuration after merging user config with defaults
 */
export type WarlockConfig = {
  /**
   * Server configuration
   */
  server?: {
    port?: number;
    host?: string;
    retryOtherPort?: boolean;
  };

  /**
   * Build configuration
   *
   * `tsconfig` and `tsconfigRaw` are deliberately omitted alongside
   * `entryPoints`. Either one applies the app's compiler options to EVERY
   * file esbuild touches, workspace packages included — so an app-level
   * `verbatimModuleSyntax: true` is imposed on package sources that were
   * never written for it, and the bundle dies at import time with
   * `Class extends value undefined`. The builder derives what it needs from
   * the app's tsconfig itself (see `buildAliasMapFromTsconfig`).
   */
  build?: Omit<BuildOptions, "entryPoints" | "tsconfig" | "tsconfigRaw"> & {
    /**
     * Output directory
     *
     * @default dist
     */
    outdir?: string;
    /**
     * Alias for {@link outdir}.
     *
     * The docs described this name for several releases while the code only
     * ever read `outdir`, so configs in the wild use it and were being
     * silently ignored. Both are accepted; `outdir` wins if you set both.
     *
     * Prefer `outdir` — it is the name esbuild itself uses, and the value
     * ends up there.
     */
    outDirectory?: string;
    /**
     * Output file
     *
     * @default app.js
     */
    outFile?: string;
    /**
     * Produce ONE self-contained file you can run with `node dist/app.js`.
     *
     * Sets `packages: "bundle"` and `splitting: false` as defaults — write
     * either of them yourself and yours wins.
     *
     * ⚠ Not literally one file: native `.node` addons cannot be inlined by
     * any bundler and are still emitted alongside it. "Single bundle" means
     * one JavaScript file plus any native addons your dependencies carry.
     *
     * Without this flag the build stays the default: dependencies remain real
     * `import` specifiers resolved from `node_modules` at runtime, which is
     * what you want when you deploy the folder rather than the file.
     *
     * @default false
     */
    singleBundle?: boolean;
    /**
     * Inject the ESM interop shim — `require`, `__filename`, `__dirname`.
     *
     * Bundled CommonJS dependencies call `require(...)` and read `__dirname`
     * to find their own assets. In an ES module none of those exist, so
     * esbuild replaces them with a stub that **throws at runtime** — after a
     * build that reported success. This recreates them via
     * `createRequire(import.meta.url)`.
     *
     * Deliberately NOT owned by {@link singleBundle}: it applies to any ESM
     * build, so setting `packages: "bundle"` by hand works too. Turn it off
     * only if you are certain nothing in your graph is CommonJS.
     *
     * @default true
     */
    esmShim?: boolean;
    /**
     * Minify output
     *
     * @default true
     */
    minify?: boolean;
    /**
     * Generate sourcemap
     *
     * @default true
     */
    sourcemap?: boolean | "inline" | "linked";
  };

  /**
   * Connectors this application adds beyond the built-in ones.
   *
   * ONE key drives both halves of a connector's life:
   *
   * - `warlock build` reads this array STATICALLY and drains each
   *   connector's `build` contribution. It never calls `boot()`/`start()` —
   *   listing a connector here does not run it.
   * - `warlock dev` and the generated production entry register the same
   *   array with the connectors manager, which is what actually boots it.
   *
   * A second key ("built for X" beside "boots X") was rejected precisely
   * because the two would drift, and that drift is silent: a green build
   * with no client bundle.
   *
   * @example
   * ```typescript
   * import { webConnector } from "@warlock.js/web/connector";
   *
   * export default defineConfig({
   *   connectors: [webConnector({ pagesDirectory: "pages" })],
   * });
   * ```
   */
  connectors?: Connector[];

  /**
   * CLI configuration
   */
  cli?: {
    commands?: CLICommand[];
  };

  /**
   * Development server configuration
   */
  devServer?: {
    /**
     * Watch configuration
     */
    watch?: {
      /**
       * Glob patterns to include in file watching
       *
       * @default ["**\/*.{ts,tsx}"]
       */
      include?: string[];
      /**
       * Glob patterns to exclude from file watching
       *
       * @default ["**\/node_modules\/**", "**\/dist\/**", "**\/.warlock\/**", "**\/.git\/**"]
       */
      exclude?: string[];
    };
    /**
     * Custom health checkers
     */
    healthCheckers?: FileHealthCheckerContract[] | false;
    /**
     * Whether to generate typings on dev server start
     * @default true
     */
    generateTypings?: boolean;
    /**
     * Check npm for a newer `@warlock.js/core` release when the dev server
     * starts and print a one-line notice if one is available. Because the
     * family is versioned in lockstep, core stands in for every package.
     * Best-effort and non-blocking; automatically skipped in CI and in
     * non-interactive (non-TTY) shells.
     * @default true
     */
    checkForUpdates?: boolean;
    /**
     * Restart the dev server automatically when a boot-time file changes —
     * `warlock.config.ts` or any `.env*`. Neither can be hot-reloaded, so
     * without a restart the running services keep using the old values.
     *
     * Set to `false` to go back to a warning telling you to restart yourself.
     * @default true
     */
    restartOnConfigChange?: boolean;
    /**
     * Debug aid for the (always-on) persisted transpile cache. Names cache
     * files `<slug>.<hash>.js` (last 3 source path segments) and appends a
     * trailing `// @source <path>` marker, so you can eyeball which entry
     * in `.warlock/transpile/` is which. Purely cosmetic — does not affect
     * cache keys, lookup, or correctness. Turn on only while diagnosing a
     * cache issue; leave off for opaque hash-only names.
     * @default false
     */
    transpileCacheDebug?: boolean;
  };

  /**
   * Database configuration
   */
  database?: {
    /**
     * Package-level migrations to include in migration runs.
     *
     * Use this to register migrations from external packages
     * (e.g., @warlock.js/auth) that are not auto-discovered.
     *
     * @example
     * ```typescript
     * import { authMigrations } from "@warlock.js/auth";
     *
     * export default defineConfig({
     *   database: {
     *     migrations: [...authMigrations],
     *   },
     * });
     * ```
     */
    migrations?: Array<MigrationConstructor>;
  };

  /**
   * Testing configuration
   *
   * High-level test settings. For detailed test behavior,
   * use config/tests.ts instead.
   */
  testing?: {
    /**
     * Additional glob patterns to include as test files.
     * Added to the default patterns.
     *
     * @example ["src/shared/[ALL]/*.test.ts"]
     */
    include?: string[];

    /**
     * Glob patterns to exclude from test discovery.
     *
     * @example [[ALL]/*.integration.test.ts"]
     */
    exclude?: string[];
  };
};
