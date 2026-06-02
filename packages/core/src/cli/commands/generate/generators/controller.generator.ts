import { colors } from "@mongez/copper";
import type { CommandActionData } from "../../../types";
import { controllerStub, schemaStub } from "../templates/stubs";
import { parseModulePath, parseName } from "../utils/name-parser";
import {
  componentExists,
  ensureComponentDirectory,
  moduleExists,
  resolveComponentPath,
} from "../utils/path-resolver";
import { putFileAsync, setDryRun } from "../utils/writer";

export async function generateController(data: CommandActionData): Promise<void> {
  const input = data.args[0];

  if (!input) {
    console.log(colors.red("Error: Controller name is required"));
    console.log(colors.yellow("Usage: warlock create.controller <module>/<name>"));
    console.log(colors.yellow("Example: warlock create.controller users/create-user"));
    process.exit(1);
  }

  const { module, name: componentName } = parseModulePath(input);

  if (!module) {
    console.log(colors.red("Error: Module name is required"));
    console.log(colors.yellow("Usage: warlock create.controller <module>/<name>"));
    process.exit(1);
  }

  // Check if module exists
  if (!(await moduleExists(module))) {
    console.log(colors.red(`Error: Module "${module}" does not exist`));
    console.log(colors.yellow(`Run: warlock create.module ${module}`));
    process.exit(1);
  }

  const name = parseName(componentName);
  const withValidation = data.options.withValidation || data.options.v;
  const force = data.options.force || data.options.f;
  setDryRun(Boolean(data.options.dryRun));

  // Check if controller already exists
  const controllerPath = resolveComponentPath(module, "controllers", `${name.kebab}.controller`);
  if ((await componentExists(module, "controllers", `${name.kebab}.controller`)) && !force) {
    console.log(colors.red(`Error: Controller "${name.kebab}.controller.ts" already exists`));
    console.log(colors.yellow("Use --force to overwrite"));
    process.exit(1);
  }

  // Ensure directories exist
  await ensureComponentDirectory(module, "controllers");

  // Generate controller
  const controllerContent = controllerStub(name, { withValidation: !!withValidation });
  await putFileAsync(controllerPath, controllerContent);

  // Generate the validation schema alongside the controller if requested.
  // The controller imports the schema's exported type + value directly —
  // there is no separate `requests/` alias file.
  if (withValidation) {
    await ensureComponentDirectory(module, "schema");

    const schemaPath = resolveComponentPath(module, "schema", `${name.kebab}.schema`);
    const schemaContent = schemaStub(name);

    await putFileAsync(schemaPath, schemaContent);
  }

  console.log(colors.cyan(`\nâœ¨ Controller "${name.camel}" generated successfully!`));
}
