import { colors } from "@mongez/copper";
import type { CommandActionData } from "../../../../commands/types";
import { useCaseSpecStub, useCaseStub } from "../templates/stubs";
import { parseModulePath, parseName } from "../utils/name-parser";
import {
  componentExists,
  ensureComponentDirectory,
  moduleExists,
  resolveComponentPath,
} from "../utils/path-resolver";
import { putFileAsync, setDryRun } from "../utils/writer";

export async function generateUseCase(data: CommandActionData): Promise<void> {
  const input = data.args[0];

  if (!input) {
    console.log(colors.red("Error: Use-case name is required"));
    console.log(colors.yellow("Usage: warlock generate.use-case <module>/<verb-noun>"));
    console.log(colors.yellow("Example: warlock generate.use-case orders/place-order"));
    process.exit(1);
  }

  const { module, name: componentName } = parseModulePath(input);

  if (!module) {
    console.log(colors.red("Error: Module name is required"));
    console.log(colors.yellow("Usage: warlock generate.use-case <module>/<verb-noun>"));
    process.exit(1);
  }

  if (!(await moduleExists(module))) {
    console.log(colors.red(`Error: Module "${module}" does not exist`));
    console.log(colors.yellow(`Run: warlock generate.module ${module}`));
    process.exit(1);
  }

  const name = parseName(componentName);
  const force = data.options.force || data.options.f;
  setDryRun(Boolean(data.options.dryRun));

  // Refuse to overwrite either file unless --force
  for (const file of [`${name.kebab}.use-case`, `${name.kebab}.use-case.spec`]) {
    if ((await componentExists(module, "use-cases", file)) && !force) {
      console.log(colors.red(`Error: Use-case file "${file}.ts" already exists`));
      console.log(colors.yellow("Use --force to overwrite"));
      process.exit(1);
    }
  }

  await ensureComponentDirectory(module, "use-cases");

  await putFileAsync(
    resolveComponentPath(module, "use-cases", `${name.kebab}.use-case`),
    useCaseStub(name),
  );
  await putFileAsync(
    resolveComponentPath(module, "use-cases", `${name.kebab}.use-case.spec`),
    useCaseSpecStub(name),
  );

  console.log(colors.cyan(`\n✨ Use-case "${name.camel}UseCase" generated successfully!`));
}
