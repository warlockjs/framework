import fs from "node:fs";
import path from "node:path";
import { readTsconfig } from "get-tsconfig";
import { Path } from "../utils/normalized-path";

export class TSConfigManager {
  /**
   * Aliases list (from tsconfig paths)
   */
  public aliases: Record<string, string[]> = {};

  /**
   * Base URL for resolving paths
   */
  public baseUrl: string = ".";

  /**
   * TSConfig
   */
  public tsconfig: any;

  public init() {
    if (this.tsconfig) return;

    // `ts.readConfigFile` does not follow `extends`; `readTsconfig` resolves the
    // whole chain (paths, baseUrl, decorator flags) and keeps string enum values,
    // which is what esbuild's `tsconfigRaw` expects.
    const configPath = Path.toAbsolute("tsconfig.json");
    const parsed = fs.existsSync(configPath)
      ? readTsconfig(configPath, { typescriptVersion: false }).config
      : {};
    const compilerOptions = parsed.compilerOptions ?? {};

    this.tsconfig = { ...parsed, compilerOptions };

    this.aliases = (compilerOptions.paths as Record<string, string[]> | undefined) || {};

    this.baseUrl = compilerOptions.baseUrl || ".";
  }

  /**
   * Check if the given path is an alias
   * This checks if it's a REAL path alias (not an external package alias)
   *
   * Real aliases map to local paths (e.g., app/* -> src/app/*, src/* -> src/*)
   * External package aliases map to themselves with @ prefix (e.g., @warlock.js/core -> @warlock.js/core)
   */
  public isAlias(path: string) {
    if (!this.tsconfig) {
      this.init();
    }

    return Object.keys(this.aliases).some((alias) => {
      if (!this.matchesAliasPattern(alias, path)) {
        return false;
      }

      const aliasTargets = this.aliases[alias];
      if (!Array.isArray(aliasTargets) || aliasTargets.length === 0) {
        return false;
      }

      // A package mapped onto itself is an external package, not a local alias
      // Example: "@warlock.js/core" -> "@warlock.js/core"
      // (self-referencing local ones like src/* -> src/* are still aliases)
      if (!alias.endsWith("/*") && aliasTargets.every((target) => target === alias)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Check if an import path matches a tsconfig paths pattern
   * (exact match, or `prefix/*` matching anything under `prefix/`)
   */
  private matchesAliasPattern(alias: string, importPath: string): boolean {
    if (alias.endsWith("/*")) {
      return importPath.startsWith(alias.slice(0, -1));
    }

    return importPath === alias;
  }

  /**
   * Get the alias key that matches the given import path
   */
  public getMatchingAlias(path: string): string | null {
    const aliasKey = Object.keys(this.aliases).find((alias) => this.matchesAliasPattern(alias, path));

    return aliasKey || null;
  }

  /**
   * Resolve an alias import path to a relative path based on tsconfig paths
   * Example: "app/users/services/get-users.service" -> "src/app/users/services/get-users.service"
   *
   * @param path - The import path with alias (e.g., "app/users/services/get-users.service")
   * @returns The resolved relative path or null if alias not found
   */
  public resolveAliasPath(checkingPath: string): string | null {
    // Find matching alias from tsconfig paths
    const aliasKey = this.getMatchingAlias(checkingPath);

    if (!aliasKey) return null;

    const aliasTargets = this.aliases[aliasKey];
    if (!Array.isArray(aliasTargets) || aliasTargets.length === 0) {
      return null;
    }

    // Get the first target path (usually there's only one)
    const targetPattern = aliasTargets[0];

    if (targetPattern === undefined) {
      return null;
    }

    // Replace alias pattern with target pattern
    const aliasPattern = aliasKey.replace("/*", "");
    const targetBase = targetPattern.replace("/*", "");
    // Remove any leading slash so path.join does not drop the base
    const relativePart = checkingPath.substring(aliasPattern.length).replace(/^[/\\]/, "");

    // Join the target base with the relative part
    const resolvedPath = path.join(targetBase, relativePart);

    return Path.normalize(resolvedPath);
  }

  /**
   * Resolve an alias import path to an absolute path
   * Example: "app/users/services/get-users.service" -> "/absolute/path/to/src/app/users/services/get-users.service"
   *
   * @param path - The import path with alias
   * @returns The resolved absolute path or null if alias not found
   */
  public resolveAliasToAbsolute(path: string): string | null {
    const relativePath = this.resolveAliasPath(path);

    if (!relativePath) return null;

    return Path.normalize(Path.toAbsolute(relativePath));
  }
}

export const tsconfigManager = new TSConfigManager();
