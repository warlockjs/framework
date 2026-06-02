import { colors } from "@mongez/copper";
import path from "node:path";
import { appPath } from "../../../../utils";
import type { CommandActionData } from "../../../types";
import {
  crudCreateControllerStub,
  crudCreateSchemaStub,
  crudCreateServiceStub,
  crudDeleteControllerStub,
  crudDeleteServiceStub,
  crudGetServiceStub,
  crudListControllerStub,
  crudListServiceStub,
  crudModelStub,
  crudRepositoryStub,
  crudResourceStub,
  crudRoutesStub,
  crudSeedStub,
  crudShowControllerStub,
  crudUpdateControllerStub,
  crudUpdateSchemaStub,
  crudUpdateServiceStub,
} from "../templates/stubs";
import { pluralName, singularName } from "../utils/name-parser";
import { moduleExists } from "../utils/path-resolver";
import { ensureDirectoryAsync, putFileAsync, setDryRun } from "../utils/writer";
import { createMigrationFile } from "./migration.generator";

export async function generateModule(data: CommandActionData): Promise<void> {
  const moduleName = data.args[0];

  if (!moduleName) {
    console.log(colors.red("Error: Module name is required"));
    console.log(colors.yellow("Usage: warlock generate.module <name> [options]"));
    console.log(colors.yellow("Example: warlock generate.module products"));
    console.log(colors.yellow("         warlock generate.module products --minimal"));
    process.exit(1);
  }

  const name = pluralName(moduleName);
  const force = data.options.force || data.options.f;
  setDryRun(Boolean(data.options.dryRun));

  // Full CRUD is the default; --minimal (-m) opts down to a bare skeleton.
  const minimal = data.options.minimal || data.options.m;
  const withCrud = !minimal;

  // Check if module already exists
  if ((await moduleExists(name.kebab)) && !force) {
    console.log(colors.red(`Error: Module "${name.kebab}" already exists`));
    console.log(colors.yellow("Use --force to overwrite"));
    process.exit(1);
  }

  const modulePath = appPath(name.kebab);

  // Create module directory structure
  const directories = [
    "controllers",
    "services",
    "models",
    "repositories",
    "schema",
    "resources",
    "events",
    "types",
    "utils",
  ];

  for (const dir of directories) {
    await ensureDirectoryAsync(path.join(modulePath, dir));
  }

  // Create main.ts
  const mainContent = `// You may use this file as a custom entry point to be executed when the app starts.
// it runs only once, and you don't need to import the routes.ts file, it will be imported automatically.
// Use it to regsiter or boot up any custom logic for this module.
`;
  await putFileAsync(path.join(modulePath, "main.ts"), mainContent);

  // Create routes.ts
  const routesContent = withCrud
    ? crudRoutesStub(name)
    : `import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";

// Define your routes here
// Example:
// router.get("/${name.kebab}", listController);
`;
  await putFileAsync(path.join(modulePath, "routes.ts"), routesContent);

  // Create utils/locales.ts
  const localesContent = `import { groupedTranslations } from "@mongez/localization";

groupedTranslations("${name.camel}", {
  // Add your translations here
  // Example:
  // welcome: {
  //   en: "Welcome",
  //   ar: "Ù…Ø±Ø­Ø¨Ø§",
  // },
});
`;
  await putFileAsync(path.join(modulePath, "utils", "locales.ts"), localesContent);

  // Full CRUD scaffold (the default) unless --minimal was passed
  if (withCrud) {
    const entity = singularName(moduleName);

    // Create controllers
    await putFileAsync(
      path.join(modulePath, "controllers", `create-${entity.kebab}.controller.ts`),
      crudCreateControllerStub(entity),
    );

    await putFileAsync(
      path.join(modulePath, "controllers", `update-${entity.kebab}.controller.ts`),
      crudUpdateControllerStub(entity),
    );

    await putFileAsync(
      path.join(modulePath, "controllers", `list-${name.kebab}.controller.ts`),
      crudListControllerStub(name),
    );

    await putFileAsync(
      path.join(modulePath, "controllers", `get-${entity.kebab}.controller.ts`),
      crudShowControllerStub(entity),
    );

    await putFileAsync(
      path.join(modulePath, "controllers", `delete-${entity.kebab}.controller.ts`),
      crudDeleteControllerStub(entity),
    );

    // Create schema files — each exports both the schema value and its
    // inferred type; controllers import them directly (no requests/ alias).
    await putFileAsync(
      path.join(modulePath, "schema", `create-${entity.kebab}.schema.ts`),
      crudCreateSchemaStub(entity),
    );

    await putFileAsync(
      path.join(modulePath, "schema", `update-${entity.kebab}.schema.ts`),
      crudUpdateSchemaStub(entity),
    );

    // Create model
    await ensureDirectoryAsync(path.join(modulePath, "models", entity.kebab));
    await putFileAsync(
      path.join(modulePath, "models", entity.kebab, `${entity.kebab}.model.ts`),
      crudModelStub(entity),
    );

    // Create model index
    await putFileAsync(
      path.join(modulePath, "models", entity.kebab, "index.ts"),
      `export * from "./${entity.kebab}.model";\n`,
    );

    // Create migrations folder
    await ensureDirectoryAsync(path.join(modulePath, "models", entity.kebab, "migrations"));

    // Create resource
    await putFileAsync(
      path.join(modulePath, "resources", `${entity.kebab}.resource.ts`),
      crudResourceStub(name),
    );

    // Create repository
    await putFileAsync(
      path.join(modulePath, "repositories", `${name.kebab}.repository.ts`),
      crudRepositoryStub(name),
    );

    // Create services
    await putFileAsync(
      path.join(modulePath, "services", `create-${entity.kebab}.service.ts`),
      crudCreateServiceStub(entity),
    );

    await putFileAsync(
      path.join(modulePath, "services", `update-${entity.kebab}.service.ts`),
      crudUpdateServiceStub(entity),
    );

    await putFileAsync(
      path.join(modulePath, "services", `list-${name.kebab}.service.ts`),
      crudListServiceStub(name),
    );

    await putFileAsync(
      path.join(modulePath, "services", `get-${entity.kebab}.service.ts`),
      crudGetServiceStub(entity),
    );

    await putFileAsync(
      path.join(modulePath, "services", `delete-${entity.kebab}.service.ts`),
      crudDeleteServiceStub(entity),
    );

    // Create seeds
    await ensureDirectoryAsync(path.join(modulePath, "seeds"));
    await putFileAsync(path.join(modulePath, "seeds", `${name.kebab}.seed.ts`), crudSeedStub(name));

    // Create migration
    await createMigrationFile(name.kebab, entity.kebab);
  }

  console.log(colors.cyan(`\nâœ¨ Module "${name.kebab}" generated successfully!`));

  if (withCrud) {
    console.log(colors.gray(`\nðŸ“¦ CRUD scaffold created with:`));
    console.log(colors.gray(`  - List, Get, Create, Update & Delete controllers`));
    console.log(colors.gray(`  - Repository`));
    console.log(colors.gray(`  - Validation schemas in schema/`));
    console.log(colors.gray(`  - Model with resource`));
    console.log(colors.gray(`  - Routes configured`));
    console.log(colors.gray(`\nNext steps:`));
    console.log(
      colors.gray(`  1. Update model schema in models/${name.kebab}/${name.kebab}.model.ts`),
    );
    console.log(colors.gray(`  2. Update schema rules in schema/*.schema.ts`));
    console.log(
      colors.gray(`  3. Create migration: warlock generate.model ${name.kebab}/${name.kebab}`),
    );
  } else {
    console.log(colors.gray(`\nNext steps:`));
    console.log(colors.gray(`  1. Define routes in ${name.kebab}/routes.ts`));
    console.log(
      colors.gray(`  2. Create controllers: warlock generate.controller ${name.kebab}/<name>`),
    );
    console.log(colors.gray(`  3. Create models: warlock generate.model ${name.kebab}/<name>`));
    console.log(colors.gray(`\nTip: omit --minimal to generate a full CRUD scaffold`));
  }
}
