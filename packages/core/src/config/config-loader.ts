import config from "@mongez/config";
import { colors } from "@mongez/copper";
import { pathToFileURL } from "node:url";
import type { FileManager } from "../dev-server/file-manager";
import { configSpecialHandlers } from "./config-special-handlers";

/**
 * Special Config Handler
 * A function that handles special configuration loading
 */
export type SpecialConfigHandler = (configValue: any) => void | Promise<void>;

/**
 * Config Loader
 * Dynamically loads all configuration files and registers them with @mongez/config
 * Supports special handlers for configs that require additional processing
 */
export class ConfigLoader {
  public async loadAll(configFiles: FileManager[]): Promise<void> {
    for (const file of configFiles) {
      await this.loadConfig(file);
    }
  }

  /**
   * Load a single configuration file.
   *
   * The ESM loader hook stamps a version token onto the URL so that each HMR
   * cycle gets a fresh module — no manual cache-busting needed here.
   */
  public async loadConfig(file: FileManager): Promise<void> {
    const configName = this.getConfigName(file.relativePath);

    try {
      const fileUrl = pathToFileURL(file.absolutePath).href;
      const configModule = await import(fileUrl);
      const configValue = configModule.default;

      if (configValue === undefined) {
        console.log(
          colors.red(`config error: `),
          `Config file ${colors.yellow(file.relativePath)} does not have a default export`,
        );
        return;
      }

      config.set(configName, configValue);
      await configSpecialHandlers.execute(configName, configValue);
    } catch (error) {
      throw error;
    }
  }

  public async reloadConfig(file: FileManager): Promise<void> {
    await this.loadConfig(file);
  }

  private getConfigName(relativePath: string): string {
    const match = relativePath.match(/^src\/config\/(.+)\.(ts|tsx)$/);

    if (!match) {
      throw new Error(`Invalid config file path: ${relativePath}`);
    }

    return match[1];
  }
}
