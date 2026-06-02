import { CLICommand } from "../cli/cli-command.mjs";
import { FileHealthCheckerContract } from "../dev-server/health-checker/file-health-checker.contract.mjs";
import { MigrationConstructor } from "@warlock.js/cascade";

//#region ../../@warlock.js/core/src/warlock-config/types.d.ts
/**
 * Resolved Warlock Configuration
 *
 * This is the final configuration after merging user config with defaults
 */
type WarlockConfig = {
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
   */
  build?: {
    /**
     * Output directory
     *
     * @default dist
     */
    outDirectory?: string;
    /**
     * Output file
     *
     * @default app.js
     */
    outFile?: string;
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
//#endregion
export { WarlockConfig };
//# sourceMappingURL=types.d.mts.map