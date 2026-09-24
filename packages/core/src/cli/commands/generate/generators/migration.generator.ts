import { colors } from "@mongez/copper";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { appPath } from "../../../../utils";
import type { CommandActionData } from "../../../../commands/types";
import { migrationAlterStub, migrationStub } from "../templates/stubs";
import { migrationTimestamp } from "../../../../generations/features/shared/migration-timestamp";
import { parseColumnDsl } from "./column-dsl-parser";
import { parseName } from "../utils/name-parser";
import { ensureDirectoryAsync, putFileAsync, setDryRun } from "../utils/writer";

/**
 * Generate a migration file for a model
 */
/**
 * Create a migration file for a model
 */
export async function createMigrationFile(
  moduleName: string,
  entityName: string,
  options: any = {},
) {
  const entity = parseName(entityName);

  // Generate timestamp: MM-DD-YYYY_HH-MM-SS
  const timestamp = migrationTimestamp();

  // "Create missing, skip existing": never write a second CREATE-table migration
  // for an entity that already has one (it would fail with "table already exists").
  const isCreate = !(options.add || options.drop || options.rename);
  const existingDir = path.join(appPath(), moduleName, "models", entity.kebab, "migrations");

  if (isCreate && existsSync(existingDir) && readdirSync(existingDir).some((file) => file.endsWith(".migration.ts"))) {
    return undefined;
  }

  const migrationFileName = `${timestamp}-${entity.kebab}.migration.ts`;
  const migrationsPath = path.join(appPath(), moduleName, "models", entity.kebab, "migrations");

  // Ensure migrations directory exists
  await ensureDirectoryAsync(migrationsPath);

  const addParams = options.add as string;
  const dropParams = options.drop as string;
  const renameParams = options.rename as string;
  const timestamps =
    options.timestamps !== "false" && options.timestamps !== false && !options.noTimestamps;

  let migrationContent = "";

  if (addParams || dropParams || renameParams) {
    // Generate alter stub
    const parsedAdd = parseColumnDsl(addParams || "");
    const helpersSet = new Set<string>();

    const addLines = parsedAdd.map((col) => {
      helpersSet.add(col.helper);
      return `    ${col.name}: ${col.helper}()${col.modifiers.join("")},`;
    });

    let formattedDrop: string | undefined = undefined;
    if (dropParams) {
      formattedDrop = JSON.stringify(dropParams.split(",").map((s) => s.trim()));
    }

    let formattedRename: string | undefined = undefined;
    if (renameParams) {
      const obj: Record<string, string> = {};
      renameParams
        .split(",")
        .map((s) => s.trim())
        .forEach((p) => {
          const [oldN, newN] = p.split(":").map((s) => s.trim());
          if (oldN && newN) obj[oldN] = newN;
        });
      formattedRename = JSON.stringify(obj, null, 2).replace(/\n/g, "\n  ");
    }

    migrationContent = migrationAlterStub(entity, {
      add: addLines.length > 0 ? addLines.join("\n") : undefined,
      drop: formattedDrop,
      rename: formattedRename,
      imports: Array.from(helpersSet),
    });
  } else {
    // Generate create stub
    migrationContent = migrationStub(entity, {
      timestamps,
    });
  }

  // Create migration file
  const migrationFilePath = path.join(migrationsPath, migrationFileName);
  await putFileAsync(migrationFilePath, migrationContent);

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
    process.exit(1);
  }

  // Parse model path (e.g., "products/product")
  const [moduleName, entityName] = modelPath.split("/");

  if (!moduleName || !entityName) {
    console.log(colors.red("Error: Invalid model path format. Expected: <module>/<entity>"));
    console.log(colors.gray("Example: warlock gen.migration products/product"));
    process.exit(1);
  }

  const entity = parseName(entityName);
  const modelFilePath = path.join(
    appPath(),
    moduleName,
    "models",
    entity.kebab,
    `${entity.kebab}.model.ts`,
  );

  if (!existsSync(modelFilePath)) {
    console.log(
      colors.red(`Error: Model not found at ${path.relative(appPath(), modelFilePath)}`),
    );
    console.log(colors.gray("Generate the model first: warlock gen.model " + modelPath));
    process.exit(1);
  }

  setDryRun(Boolean(data.options.dryRun));

  const migrationFilePath = await createMigrationFile(moduleName, entityName, data.options);

  if (!migrationFilePath) {
    console.log(
      colors.yellow(
        "Skipped: this model already has a create migration. Use --add/--drop/--rename for changes.",
      ),
    );
    return;
  }

  console.log(
    colors.cyan(`\n✨ Migration file created at: ${path.relative(appPath(), migrationFilePath)}`),
  );
}
