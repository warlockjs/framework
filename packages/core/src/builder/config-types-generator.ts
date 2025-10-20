import { ensureDirectoryAsync, putFileAsync } from "@mongez/fs";
import path from "path";
import { globFiles } from "../utils/glob";
import { rootPath, warlockPath } from "../utils/paths";

/**
 * Generate TypeScript types for config keys using module augmentation
 * This enables autocomplete and type safety for config.get()
 */
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
      .filter(key => key !== "index") // Skip index files
      .sort(); // Alphabetical order for consistency

    // Generate module augmentation file
    const typeDefinition = `/**
 * Auto-generated config types via Module Augmentation
 * DO NOT EDIT MANUALLY - This file is regenerated on every build
 *
 * Add new config files to src/config/ and they will be automatically detected
 * 
 * For deep type inference, augment ConfigTypeMap:
 * 
 * declare module "@warlock.js/core" {
 *   interface ConfigTypeMap {
 *     database: import("@warlock.js/cascade").DatabaseConfigurations;
 *     app: import("@warlock.js/core").AppConfigurations;
 *   }
 * }
 */

declare module "@warlock.js/core" {
  /**
   * Project-specific config keys (autocomplete in config.get())
   */
  export type ConfigKeys = ${configKeys.map(key => `"${key}"`).join(" | ")};
  
  /**
   * Augment this interface to add return types for config.get()
   * 
   * Example:
   *   interface ConfigTypeMap {
   *     database: import("@warlock.js/cascade").DatabaseConfigurations;
   *   }
   */
  // interface ConfigTypeMap {} // Uncomment and add your types here
}
`;

    // Ensure .warlock directory exists
    await ensureDirectoryAsync(warlockPath());

    // Write type augmentation file
    const outputPath = warlockPath("config-augmentation.d.ts");
    await putFileAsync(outputPath, typeDefinition);

    console.log(
      `✓ Generated config types for ${configKeys.length} configurations: ${configKeys.join(", ")}`,
    );

    return configKeys;
  } catch (error) {
    console.warn(
      "⚠️ Failed to generate config types:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}
