import { colors } from "@mongez/copper";
import { ensureDirectoryAsync, putFileAsync } from "@mongez/fs";
import path from "node:path";
import { appPath } from "../../../../utils";
import type { CommandActionData } from "../../../types";
import { migrationStub } from "../templates/stubs";
import { parseName } from "../utils/name-parser";

/**
 * Generate a migration file for a model
 */
/**
 * Create a migration file for a model
 */
export async function createMigrationFile(moduleName: string, entityName: string) {
  const entity = parseName(entityName);

  // Generate timestamp: MM-DD-YYYY_HH-MM-SS
  const now = new Date();
  const timestamp = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${now.getFullYear()}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;

  const migrationFileName = `${timestamp}-${entity.kebab}.migration.ts`;
  const migrationsPath = path.join(appPath(), moduleName, "models", entity.kebab, "migrations");

  // Ensure migrations directory exists
  await ensureDirectoryAsync(migrationsPath);

  // Create migration file
  const migrationFilePath = path.join(migrationsPath, migrationFileName);
  await putFileAsync(migrationFilePath, migrationStub(entity));

  console.log(colors.green(`✓ Created ${migrationFileName}`));
  return migrationFilePath;
}

/**
 * Generate a migration file for a model
 */
export async function generateMigration(data: CommandActionData) {
  const modelPath = data.args[0] as string;

  if (!modelPath) {
    console.log(colors.red("Error: Model path is required"));
    console.log(colors.gray("Usage: warlock gen.migration <model-path>"));
    console.log(colors.gray("Example: warlock gen.migration products/product"));
    return;
  }

  // Parse model path (e.g., "products/product")
  const [moduleName, entityName] = modelPath.split("/");

  if (!moduleName || !entityName) {
    console.log(colors.red("Error: Invalid model path format. Expected: <module>/<entity>"));
    console.log(colors.gray("Example: warlock gen.migration products/product"));
    return;
  }

  const migrationFilePath = await createMigrationFile(moduleName, entityName);

  console.log(
    colors.cyan(`\n✨ Migration file created at: ${path.relative(appPath(), migrationFilePath)}`),
  );
}
