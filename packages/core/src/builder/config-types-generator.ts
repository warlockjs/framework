import { getFileAsync, putFileAsync } from "@mongez/fs";
import path from "path";
import { globFiles } from "../utils/glob";
import { rootPath, warlockPath } from "../utils/paths";

/**
 * Check if tsconfig.json includes .warlock types
 * If not, log a warning to help the user
 */
async function checkTsConfigIncludes() {
  try {
    const tsconfigPath = rootPath("tsconfig.json");
    const tsconfigContent = await getFileAsync(tsconfigPath);

    if (!tsconfigContent) return;

    // Check if .warlock types are in the include array
    const warlockPattern = ".warlock/**/*.d.ts";
    const hasWarlockTypes =
      tsconfigContent.includes(`"${warlockPattern}"`) ||
      tsconfigContent.includes(`'${warlockPattern}'`);

    if (!hasWarlockTypes) {
      console.warn(
        `⚠️  [config types] Add "${warlockPattern}" to tsconfig.json "include" array for config autocomplete`,
      );
      console.info(
        `ℹ️  [config types] Example: "include": ["src", "${warlockPattern}"]`,
      );
    }
  } catch (error) {
    // Silently fail - tsconfig.json might not exist or be malformed
  }
}

export async function generateConfigTypes() {
  try {
    // Find all config files in src/config/
    const configDir = rootPath("src/config");
    const configFiles = await globFiles(configDir, {
      extensions: [".ts", ".tsx", ".js"],
    });

    // Extract config keys from file names
    const configKeys = configFiles
      .map(filePath => {
        const fileName = path.basename(filePath);
        // Remove extension (.ts, .tsx, .js)
        return fileName.replace(/\.(ts|tsx|js)$/, "");
      })
      .filter(key => key !== "index" && key !== "config-types") // Skip index and config-types files
      .sort(); // Alphabetical order for consistency

    // Generate module augmentation file that links to user's config-types.ts
    const typeDefinition = `/**
 * Auto-generated config types via Module Augmentation
 * DO NOT EDIT MANUALLY - This file is regenerated on every build
 *
 * Config keys are auto-detected from src/config/
 * Type mappings are defined in src/config/config-types.ts (you can edit that file!)
 */

/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { ConfigTypeMap as UserConfigTypeMap } from "../src/config/config-types";

declare module "@warlock.js/core" {
  /**
   * Augment ConfigKeysRegistry with project-specific config keys
   * ConfigKeys type is automatically derived from this interface
   */
  interface ConfigKeysRegistry {
${configKeys.map(key => `    ${key}: true;`).join("\n")}
  }
  
  /**
   * Extend ConfigTypeMap with user's type mappings
   * Edit src/config/config-types.ts to add/modify types!
   */
  interface ConfigTypeMap extends UserConfigTypeMap {}
}
`;

    // Write type augmentation file
    const outputPath = warlockPath("config-augmentation.d.ts");
    await putFileAsync(outputPath, typeDefinition);

    // Check if tsconfig.json includes .warlock/**/*.d.ts
    await checkTsConfigIncludes();

    return configKeys;
  } catch (error) {
    console.warn(
      "⚠️ Failed to generate config types:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}
