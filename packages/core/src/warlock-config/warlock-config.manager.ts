import { fileExistsAsync } from "@warlock.js/fs";
import { get } from "@mongez/reinforcements";
import { getTsconfig } from "get-tsconfig";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "url";
import { rootPath } from "../utils";
import { bundleWarlockConfig } from "./bundle-config";
import { type WarlockConfig } from "./types";
import { getDeprecatedConfigWarnings } from "./warn-deprecated-config";

/**
 * `Error` with the ES2022 `cause` option, typed for packages still compiled
 * against an older lib (see `application.ts`).
 */
const ErrorWithCause = Error as new (message: string, options: { cause: unknown }) => Error;

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
 * True when `error` is Node failing to RESOLVE an import of the config's OWN
 * graph: an extensionless relative import (`./src/connectors/local`), a
 * directory import, or a tsconfig `paths` alias (`app/connectors`) — all of
 * which only a TypeScript toolchain resolves. Native type stripping
 * (Node ≥ 22.18) loads `warlock.config.ts` itself, then fails here.
 *
 * A package that is genuinely not installed is NOT a fallback case: the error
 * names a bare specifier that matches no `paths` pattern, and it is rethrown
 * as is. Neither is a missing module imported from inside `node_modules`.
 *
 * `pathAliases` are the tsconfig `paths` patterns (`app/*`). When the message
 * cannot be parsed the error is treated as a graph error, as before.
 */
export function isUnresolvedConfigImportError(
  error: unknown,
  pathAliases: readonly string[] = [],
): boolean {
  const code = (error as { code?: string })?.code;

  if (code === "ERR_UNSUPPORTED_DIR_IMPORT") return true;
  if (code !== "ERR_MODULE_NOT_FOUND") return false;

  const message = String((error as Error)?.message ?? "");
  const match = /Cannot find (module|package) '([^']+)' imported from (.+)$/m.exec(message);

  if (!match) return true;

  const [, kind, specifier = "", importer = ""] = match;

  if (/[\\/]node_modules[\\/]/.test(importer)) return false;

  // An unresolved relative or absolute path: an extensionless TS import.
  if (kind === "module") return true;

  // A bare name: only a tsconfig alias is the config graph's own code.
  return pathAliases.some((pattern) => aliasCovers(pattern, specifier));
}

/**
 * True when `error` is native type stripping refusing TypeScript it cannot
 * strip (an `enum`, a `namespace`, a parameter property) or a `.ts` file under
 * `node_modules`. Both are raised while loading, before the graph runs.
 */
export function isUnsupportedTypeStrippingError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;

  return (
    code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX" ||
    code === "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING"
  );
}

/**
 * True when a tsconfig `paths` pattern can produce `packageName` as the first
 * segment(s) of a specifier: `app/*` covers `app`, `@shared/*` covers
 * `@shared`, a catch-all `*` covers anything.
 */
function aliasCovers(pattern: string, packageName: string): boolean {
  const star = pattern.indexOf("*");
  const prefix = star === -1 ? pattern : pattern.slice(0, star);

  if (prefix === "") return true;

  return (
    prefix === packageName || prefix.startsWith(`${packageName}/`) || packageName.startsWith(prefix)
  );
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

    try {
      this.config = await this.loading;
    } finally {
      // A failed load must not stay cached: a later call retries instead of
      // replaying the same rejection.
      this.loading = undefined;
    }

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
      // older Node the import throws ERR_UNKNOWN_FILE_EXTENSION; native
      // stripping cannot resolve extensionless or tsconfig-aliased local
      // imports, nor strip an `enum` or a parameter property. Bundle the
      // config's local graph with esbuild ourselves so config loading is
      // Node-version-independent.
      //
      // These errors are raised while resolving and loading the STATIC graph,
      // before any of it runs. An unresolved import reached later — a dynamic
      // `import()` while the config runs — is indistinguishable by code, so the
      // fallback is limited to the config's own relative and aliased imports.
      if (
        isUnknownTsExtensionError(error) ||
        isUnsupportedTypeStrippingError(error) ||
        isUnresolvedConfigImportError(error, configPathAliases(configPath))
      ) {
        return await this.loadViaEsbuild(configPath);
      }

      throw new ErrorWithCause(`Failed to load warlock.config.ts: ${error}`, { cause: error });
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
    } catch (error) {
      throw nameOriginalConfig(error, compiledPath, configPath);
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
 * The tsconfig `paths` patterns of the project holding `configPath`.
 */
function configPathAliases(configPath: string): string[] {
  try {
    return Object.keys(getTsconfig(path.dirname(configPath))?.config.compilerOptions?.paths ?? {});
  } catch {
    return [];
  }
}

/**
 * A loader error raised by the bundled config names the temporary `.mjs`
 * module. Rewrite it to name `warlock.config.ts`, keeping the original as the
 * cause. An error thrown by the user's own config is returned unchanged.
 */
function nameOriginalConfig(error: unknown, compiledPath: string, configPath: string): unknown {
  const code = (error as { code?: string })?.code;

  if (typeof code !== "string" || !code.startsWith("ERR_")) return error;

  const message = String((error as Error).message ?? error)
    .split(pathToFileURL(compiledPath).href)
    .join(pathToFileURL(configPath).href)
    .split(compiledPath)
    .join(configPath);

  const wrapped = new ErrorWithCause(`Failed to load warlock.config.ts: ${message}`, {
    cause: error,
  });

  (wrapped as Error & { code?: string }).code = code;

  return wrapped;
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
