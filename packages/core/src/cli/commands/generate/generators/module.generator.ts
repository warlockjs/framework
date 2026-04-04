import { colors } from "@mongez/copper";
import { ensureDirectoryAsync, putFileAsync } from "@mongez/fs";
import path from "node:path";
import { appPath } from "../../../../utils";
import type { CommandActionData } from "../../../types";
import {
  crudCreateControllerStub,
  crudCreateServiceStub,
  crudCreateValidationStub,
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
  crudUpdateServiceStub,
  crudUpdateValidationStub,
  requestStub,
} from "../templates/stubs";
import { parseName } from "../utils/name-parser";
import { moduleExists } from "../utils/path-resolver";
import { createMigrationFile } from "./migration.generator";

export async function generateModule(data: CommandActionData): Promise<void> {
  const moduleName = data.args[0];

  if (!moduleName) {
    console.log(colors.red("Error: Module name is required"));
    console.log(colors.yellow("Usage: warlock generate.module <name> [options]"));
    console.log(colors.yellow("Example: warlock generate.module products"));
    console.log(colors.yellow("         warlock generate.module products --crud"));
    process.exit(1);
  }

  const name = parseName(moduleName);
  const force = data.options.force || data.options.f;
  const withCrud = data.options.crud || data.options.c;

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
    "validation",
    "requests",
    "resources",
    "events",
    "types",
    "utils",
  ];

  for (const dir of directories) {
    await ensureDirectoryAsync(path.join(modulePath, dir));
  }

  console.log(colors.green(`✓ Created module structure`));

  // Create main.ts
  const mainContent = `import { onceConnected } from "@warlock.js/cascade";

// This function will be called once the app is connected to the database
onceConnected(async () => {
  // Module initialization code
  // Register event listeners
  // Setup module-specific configurations
});
`;
  await putFileAsync(path.join(modulePath, "main.ts"), mainContent);
  console.log(colors.green(`✓ Created main.ts`));

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
  console.log(colors.green(`✓ Created routes.ts`));

  // Create utils/locales.ts
  const localesContent = `import { groupedTranslations } from "@mongez/localization";

groupedTranslations("${name.camel}", {
  // Add your translations here
  // Example:
  // welcome: {
  //   en: "Welcome",
  //   ar: "مرحبا",
  // },
});
`;
  await putFileAsync(path.join(modulePath, "utils", "locales.ts"), localesContent);
  console.log(colors.green(`✓ Created utils/locales.ts`));

  // If --crud flag is set, generate full CRUD scaffold
  if (withCrud) {
    // Derive singular entity name from plural module name
    const entityKebab = name.kebab.endsWith("s") ? name.kebab.slice(0, -1) : name.kebab;
    const entity = parseName(entityKebab);

    // Create controllers
    await putFileAsync(
      path.join(modulePath, "controllers", `create-${entity.kebab}.controller.ts`),
      crudCreateControllerStub(name),
    );
    console.log(colors.green(`✓ Created create-${entity.kebab}.controller.ts`));

    await putFileAsync(
      path.join(modulePath, "controllers", `update-${entity.kebab}.controller.ts`),
      crudUpdateControllerStub(name),
    );
    console.log(colors.green(`✓ Created update-${entity.kebab}.controller.ts`));

    await putFileAsync(
      path.join(modulePath, "controllers", `list-${name.kebab}.controller.ts`),
      crudListControllerStub(name),
    );
    console.log(colors.green(`✓ Created list-${name.kebab}.controller.ts`));

    await putFileAsync(
      path.join(modulePath, "controllers", `get-${entity.kebab}.controller.ts`),
      crudShowControllerStub(name),
    );
    console.log(colors.green(`✓ Created get-${entity.kebab}.controller.ts`));

    await putFileAsync(
      path.join(modulePath, "controllers", `delete-${entity.kebab}.controller.ts`),
      crudDeleteControllerStub(name),
    );
    console.log(colors.green(`✓ Created delete-${entity.kebab}.controller.ts`));

    // Create schema files
    await putFileAsync(
      path.join(modulePath, "schema", `create-${entity.kebab}.schema.ts`),
      crudCreateValidationStub(name),
    );
    console.log(colors.green(`✓ Created create-${entity.kebab}.schema.ts`));

    await putFileAsync(
      path.join(modulePath, "schema", `update-${entity.kebab}.schema.ts`),
      crudUpdateValidationStub(name),
    );
    console.log(colors.green(`✓ Created update-${entity.kebab}.schema.ts`));

    // Create request types
    const createRequestName = parseName(`create-${entity.kebab}`);
    await putFileAsync(
      path.join(modulePath, "requests", `create-${entity.kebab}.request.ts`),
      requestStub(createRequestName),
    );
    console.log(colors.green(`✓ Created create-${entity.kebab}.request.ts`));

    const updateRequestName = parseName(`update-${entity.kebab}`);
    await putFileAsync(
      path.join(modulePath, "requests", `update-${entity.kebab}.request.ts`),
      requestStub(updateRequestName),
    );
    console.log(colors.green(`✓ Created update-${entity.kebab}.request.ts`));

    // Create model
    await ensureDirectoryAsync(path.join(modulePath, "models", entity.kebab));
    await putFileAsync(
      path.join(modulePath, "models", entity.kebab, `${entity.kebab}.model.ts`),
      crudModelStub(name),
    );
    console.log(colors.green(`✓ Created ${entity.kebab}.model.ts`));

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
    console.log(colors.green(`✓ Created ${entity.kebab}.resource.ts`));

    // Create repository
    await putFileAsync(
      path.join(modulePath, "repositories", `${name.kebab}.repository.ts`),
      crudRepositoryStub(name),
    );
    console.log(colors.green(`✓ Created ${name.kebab}.repository.ts`));

    // Create services
    await putFileAsync(
      path.join(modulePath, "services", `create-${entity.kebab}.service.ts`),
      crudCreateServiceStub(name),
    );
    console.log(colors.green(`✓ Created create-${entity.kebab}.service.ts`));

    await putFileAsync(
      path.join(modulePath, "services", `update-${entity.kebab}.service.ts`),
      crudUpdateServiceStub(name),
    );
    console.log(colors.green(`✓ Created update-${entity.kebab}.service.ts`));

    await putFileAsync(
      path.join(modulePath, "services", `list-${name.kebab}.service.ts`),
      crudListServiceStub(name),
    );
    console.log(colors.green(`✓ Created list-${name.kebab}.service.ts`));

    await putFileAsync(
      path.join(modulePath, "services", `get-${entity.kebab}.service.ts`),
      crudGetServiceStub(name),
    );
    console.log(colors.green(`✓ Created get-${entity.kebab}.service.ts`));

    await putFileAsync(
      path.join(modulePath, "services", `delete-${entity.kebab}.service.ts`),
      crudDeleteServiceStub(name),
    );
    console.log(colors.green(`✓ Created delete-${entity.kebab}.service.ts`));

    // Create seeds
    await ensureDirectoryAsync(path.join(modulePath, "seeds"));
    await putFileAsync(path.join(modulePath, "seeds", `${name.kebab}.seed.ts`), crudSeedStub(name));
    console.log(colors.green(`✓ Created ${name.kebab}.seed.ts`));

    // Create migration
    await createMigrationFile(name.kebab, entity.kebab);
  }

  console.log(colors.cyan(`\n✨ Module "${name.kebab}" generated successfully!`));

  if (withCrud) {
    console.log(colors.gray(`\n📦 CRUD scaffold created with:`));
    console.log(colors.gray(`  - List, Get, Create & Update controllers`));
    console.log(colors.gray(`  - Repository`));
    console.log(colors.gray(`  - Validation schemas in schema/`));
    console.log(colors.gray(`  - Request types`));
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
    console.log(colors.gray(`\nTip: Use --crud flag to generate a full CRUD scaffold`));
  }
}
