import { colors } from "@mongez/copper";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { CommandActionData } from "../../../../commands/types";
import { migrationTimestamp } from "../../../../generations/features/shared/migration-timestamp";
import { migrationStub, modelStub, resourceStub } from "../templates/stubs";
import { parseModulePath, singularName } from "../utils/name-parser";
import {
  componentExists,
  ensureComponentDirectory,
  moduleExists,
  resolveComponentPath,
  resolveModulePath,
} from "../utils/path-resolver";
import {
  ensureDirectoryAsync,
  putFileAsync,
  reportSkippedFiles,
  setDryRun,
  setSkipExisting,
} from "../utils/writer";

export async function generateModel(data: CommandActionData): Promise<void> {
  const input = data.args[0];

  if (!input) {
    console.log(colors.red("Error: Model name is required"));
    console.log(colors.yellow("Usage: warlock generate.model <module>/<name>"));
    console.log(colors.yellow("Example: warlock generate.model users/user"));
    process.exit(1);
  }

  const { module, name: componentName } = parseModulePath(input);

  if (!module) {
    console.log(colors.red("Error: Module name is required"));
    console.log(colors.yellow("Usage: warlock generate.model <module>/<name>"));
    process.exit(1);
  }

  // Check if module exists
  if (!(await moduleExists(module))) {
    console.log(colors.red(`Error: Module "${module}" does not exist`));
    console.log(colors.yellow(`Run: warlock generate.module ${module}`));
    process.exit(1);
  }

  const name = singularName(componentName);
  const force = data.options.force || data.options.f;
  setDryRun(Boolean(data.options.dryRun));
  // --force only creates what is missing; replacing edited files needs --overwrite too
  setSkipExisting(!data.options.overwrite);
  const withResource = data.options.withResource || data.options.rs;
  const tableName = (data.options.table as string) || name.plural.snake;

  // Check if model already exists
  const modelDir = path.join(resolveModulePath(module), "models", name.kebab);
  const modelPath = path.join(modelDir, `${name.kebab}.model.ts`);

  if ((await componentExists(module, `models/${name.kebab}`, `${name.kebab}.model`)) && !force) {
    console.log(colors.red(`Error: Model "${name.kebab}" already exists`));
    console.log(colors.yellow("Use --force to overwrite"));
    process.exit(1);
  }

  // Ensure directories exist
  await ensureDirectoryAsync(modelDir);
  await ensureDirectoryAsync(path.join(modelDir, "migrations"));

  // Generate model
  const modelContent = modelStub(name, { tableName, withResource: !!withResource });
  await putFileAsync(modelPath, modelContent);

  // The model imports ../../resources/<name>.resource, so that file must exist
  if (withResource) {
    const resourceFile = `${name.singular.kebab}.resource`;

    if (force || !(await componentExists(module, "resources", resourceFile))) {
      await ensureComponentDirectory(module, "resources");
      await putFileAsync(
        resolveComponentPath(module, "resources", resourceFile),
        resourceStub(name),
      );
    }
  }

  // Generate index.ts
  const indexContent = `export * from "./${name.kebab}.model";
`;
  await putFileAsync(path.join(modelDir, "index.ts"), indexContent);

  // Generate migration (skip when one already exists, e.g. on --force)
  const migrationsDir = path.join(modelDir, "migrations");
  const hasMigration =
    existsSync(migrationsDir) &&
    readdirSync(migrationsDir).some((file) => file.endsWith(".migration.ts"));
  const timestamp = migrationTimestamp();
  const migrationPath = path.join(
    modelDir,
    "migrations",
    `${timestamp}-${name.kebab}.migration.ts`,
  );

  const migrationContent = migrationStub(name, {
    timestamps:
      data.options.timestamps !== "false" &&
      data.options.timestamps !== false &&
      !data.options.noTimestamps,
  });

  if (!hasMigration) {
    await putFileAsync(migrationPath, migrationContent);
  }

  reportSkippedFiles();

  console.log(colors.cyan(`\n✨ Model "${name.pascal}" generated successfully!`));
  console.log(colors.gray(`\nNext steps:`));
  console.log(colors.gray(`  1. Update model schema in ${name.kebab}.model.ts`));
  console.log(
    colors.gray(
      hasMigration
        ? `  2. Existing migration kept; add changes with: warlock gen.migration ${module}/${name.kebab} --add ...`
        : `  2. Update migration in migrations/${timestamp}-${name.kebab}.migration.ts`,
    ),
  );
  console.log(colors.gray(`  3. Run migration: warlock migrate`));
}
