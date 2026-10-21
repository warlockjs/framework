import { isConfigFile } from "../dev-server/special-file-patterns";
import config from "@mongez/config";
import { colors } from "@mongez/copper";
import { pathToFileURL } from "node:url";
import type { FileManager } from "../dev-server/file-manager";
import { importAppModule } from "../loader/app-module-importer";
import { configKeyFromPath } from "./config-key-from-path";
import { type ConfigIssue, InvalidConfigError, validateConfigValue } from "./config-schema";
import { configSpecialHandlers } from "./config-special-handlers";

/**
 * Special Config Handler
 * A function that handles special configuration loading
 */
// Returns unknown, not void: ConfigSpecialHandlers.execute() RETURNS handler(config)
// rather than discarding it, and a test pins that ("returns the handler's resolved
// value"). The implementation and the test agreed; only this type said handlers
// produce nothing, which made any value-returning handler fail to typecheck.
export type SpecialConfigHandler = (configValue: any) => unknown | Promise<unknown>;

/**
 * Config Loader
 * Dynamically loads all configuration files and registers them with @mongez/config
 * Supports special handlers for configs that require additional processing
 */
export class ConfigLoader {
  /**
   * Load every config file, then throw one {@link InvalidConfigError} listing
   * every value that fails its file's `configSchema`. An invalid config is
   * still registered (later files may read it while loading) but its special
   * handler does not run, so nothing connects with a broken configuration.
   */
  public async loadAll(configFiles: FileManager[]): Promise<void> {
    const issues: ConfigIssue[] = [];

    for (const file of configFiles) {
      issues.push(...(await this.loadConfigFile(file, "register-invalid")));
    }

    if (issues.length > 0) throw new InvalidConfigError(issues);
  }

  /**
   * Load a single configuration file.
   *
   * The ESM loader hook stamps a version token onto the URL so that each HMR
   * cycle gets a fresh module — no manual cache-busting needed here.
   */
  public async loadConfig(file: FileManager): Promise<void> {
    const issues = await this.loadConfigFile(file, "keep-previous");

    if (issues.length > 0) throw new InvalidConfigError(issues);
  }

  /**
   * Import, validate and register one config file. Returns the schema issues.
   * On a hot reload (`keep-previous`) an invalid value is not registered, so
   * the running app keeps its last valid configuration.
   */
  private async loadConfigFile(
    file: FileManager,
    whenInvalid: "register-invalid" | "keep-previous",
  ): Promise<ConfigIssue[]> {
    if (!isConfigFile(file.relativePath)) return [];

    const configName = this.getConfigName(file.relativePath);

    const fileUrl = pathToFileURL(file.absolutePath).href;
    const configModule = await importAppModule(fileUrl);
    const configValue = configModule.default;

    if (configValue === undefined) {
      console.log(
        colors.red(`config error: `),
        `Config file ${colors.yellow(file.relativePath)} does not have a default export`,
      );
      return [];
    }

    const issues = await validateConfigValue(configName, configValue, configModule.configSchema);

    if (issues.length > 0) {
      if (whenInvalid === "register-invalid") config.set(configName, configValue);
      return issues;
    }

    config.set(configName, configValue);
    await configSpecialHandlers.execute(configName, configValue);

    return [];
  }

  public async reloadConfig(file: FileManager): Promise<void> {
    await this.loadConfig(file);
  }

  private getConfigName(relativePath: string): string {
    const configName = configKeyFromPath(relativePath);

    if (!configName) {
      throw new Error(`Invalid config file path: ${relativePath}`);
    }

    return configName;
  }
}
