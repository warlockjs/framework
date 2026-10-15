import { fileExistsAsync } from "@warlock.js/fs";
import { get } from "@mongez/reinforcements";
import { unlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "url";
import { rootPath } from "../utils";
import { bundleWarlockConfig } from "./bundle-config";
import { type WarlockConfig } from "./types";
import { getDeprecatedConfigWarnings } from "./warn-deprecated-config";

/**
 * True when `error` is Node's "this runtime can't import a `.ts` file" error.
 *
 * Node only executes TypeScript natively from v22.18 / v23.6 onward (earlier
 * 22.x needs `--experimental-strip-types`). On older runtimes a bare
 * `import("warlock.config.ts")` throws `ERR_UNKNOWN_FILE_EXTENSION` — which is
 * the signal to fall back to transpiling the config ourselves.
 */
export function isUnknownTsExtensionError(error: unknown): boolean {
  return (
    (error as { code?: string })?.code === "ERR_UNKNOWN_FILE_EXTENSION" ||
    /Unknown file extension "\.tsx?"/.test(String((error as Error)?.message))
  );
}

/**
 * True when `error` is Node failing to RESOLVE an import of the config graph:
 * an extensionless relative import (`./src/connectors/local`), a directory
 * import, or a tsconfig `paths` alias (`app/connectors`) — all of which only a
 * TypeScript toolchain resolves. Native type stripping (Node ≥ 22.18) loads
 * `warlock.config.ts` itself, then fails here.
 *
 * Resolution fails while linking, before any module of the graph has run, so
 * falling back to the bundled loader never executes the config twice.
 */
export function isUnresolvedConfigImportError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;

  return code === "ERR_MODULE_NOT_FOUND" || code === "ERR_UNSUPPORTED_DIR_IMPORT";
}

/**
 * Warlock Config Manager
 *
 * Manages lazy loading of the pre-compiled warlock.config.js file
 * from the .warlock/cache directory.
 */
export class WarlockConfigManager {
  /**
   * Cached config instance
   */
  private config?: WarlockConfig;

  /**
   * Loading promise to prevent duplicate loads
   */
  private loading?: Promise<WarlockConfig | undefined>;

  /**
   * Load warlock.config.js (cached after first load)
   *
   * @returns The resolved Warlock configuration
   */
  public async load(): Promise<WarlockConfig | undefined> {
    // Already loaded
    if (this.config) {
      return this.config;
    }

    // Currently loading (prevent duplicate loads)
    if (this.loading) {
      return this.loading;
    }

    // Start loading
    this.loading = this.doLoad();
    this.config = await this.loading;
    this.loading = undefined;

    // Console, not the logger: this runs before any log channel exists.
    for (const warning of getDeprecatedConfigWarnings(this.config)) {
      console.warn(warning);
    }

    return this.config;
  }

  /**
   * Internal load implementation
   *
   * The ESM loader hook transpiles `warlock.config.ts` on import â€” no
   * separate compile-to-disk step is needed.
   */
  private async doLoad(): Promise<WarlockConfig | undefined> {
    const configPath = rootPath("warlock.config.ts");

    if (!(await fileExistsAsync(configPath))) {
      // Written straight to the console, NOT through `@warlock.js/logger`.
      // This runs during CLI bootstrap, before `LoggerConnector.start()` has
      // configured a single channel, so a logger call here reaches nobody in
      // any application — the warning would be silently dropped exactly when
      // the user most needs it.
      console.warn(
        "warlock.config.ts is missing — create it at the project root (see https://warlock.js.org/docs for the config reference)",
      );
      return;
    }

    try {
      const configModule = await import(pathToFileURL(configPath).href);
      return configModule.default;
    } catch (error) {
      // `dev` registers a TS loader hook, and Node ≥ 22.18 / 23.6 strips types
      // natively — in both cases the direct import above works for a
      // self-contained config. But `build` / `start` register no hook, so on an
      // older Node the import throws ERR_UNKNOWN_FILE_EXTENSION, and native
      // stripping cannot resolve extensionless or tsconfig-aliased local
      // imports. Bundle the config's local graph with esbuild ourselves so
      // config loading is Node-version-independent rather than relying on an
      // experimental runtime feature.
      if (isUnknownTsExtensionError(error) || isUnresolvedConfigImportError(error)) {
        return await this.loadViaEsbuild(configPath);
      }

      throw new Error(`Failed to load warlock.config.ts: ${error}`);
    }
  }

  /**
   * Fallback config loader for runtimes that cannot import the config as written.
   *
   * Bundles `warlock.config.ts` with its LOCAL import graph (relative imports,
   * extensionless TS imports, tsconfig `paths` aliases) through esbuild, keeping
   * every package external so `BaseConnector`, the container and other
   * registries keep the application's identity (see `bundleWarlockConfig`).
   * The bundle is written as a sibling `.mjs` — so its external imports resolve
   * from the project exactly as they would from the original config — imported
   * once, then removed whether it loaded or threw. An error thrown by the
   * user's config propagates unchanged.
   */
  private async loadViaEsbuild(configPath: string): Promise<WarlockConfig | undefined> {
    const code = await bundleWarlockConfig(configPath);

    // Unique sibling name so concurrent processes never clobber each other.
    const compiledPath = configPath.replace(
      /warlock\.config\.ts$/,
      `.warlock.config.${process.pid}.${Date.now()}.mjs`,
    );

    await writeFile(compiledPath, code, "utf8");

    try {
      const configModule = await import(pathToFileURL(compiledPath).href);
      return configModule.default;
    } finally {
      await unlink(compiledPath).catch(() => {});
    }
  }

  /**
   * Get config value by key (dot notation supported)
   *
   * @example
   * config.get("server.port") // Returns 3000
   * config.get("cli.commands") // Returns array of commands
   *
   * @param key - Config key (supports dot notation), autocompletes for first level only
   * @returns The config value
   * @throws Error if config is not loaded
   */
  public get<Key extends keyof WarlockConfig>(
    key: Key,
    defaultValue?: WarlockConfig[Key],
  ): WarlockConfig[Key] {
    if (!this.config) {
      throw new Error("WarlockConfig not loaded. Call load() first or use lazyGet().");
    }

    return get(this.config, key as string, defaultValue);
  }

  /**
   * Lazy get - loads config if not already loaded
   *
   * @example
   * const port = await config.lazyGet("server");
   *
   * @param key - Config key (supports dot notation), autocompletes for first level only
   * @param defaultValue - Default value if config key is undefined
   * @returns The config value
   */
  async lazyGet<Key extends keyof WarlockConfig>(
    key: Key,
    defaultValue?: WarlockConfig[Key],
  ): Promise<WarlockConfig[Key]> {
    await this.load();
    return this.get(key, defaultValue);
  }

  /**
   * Check if config is loaded
   */
  public get isLoaded(): boolean {
    return this.config !== undefined;
  }

  /**
   * Get the entire config object
   *
   * @throws Error if config is not loaded
   */
  public getAll(): WarlockConfig {
    if (!this.config) {
      throw new Error("WarlockConfig not loaded. Call load() first or use lazyGet().");
    }

    return this.config;
  }

  /**
   * Reload config (useful for HMR/development)
   */
  public async reload(): Promise<void> {
    this.config = undefined;
    this.loading = undefined;
    await this.load();
  }
}

/**
 * Exported singleton instance
 *
 * @example
 * import { warlockConfig } from "@warlock.js/core";
 *
 * // Lazy load and get value
 * const port = await warlockConfig.lazyGet("server.port");
 *
 * // Or load first, then get
 * await warlockConfig.load();
 * const commands = warlockConfig.get("cli.commands");
 */
export const warlockConfigManager = new WarlockConfigManager();
