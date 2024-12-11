import { ensureDirectoryAsync } from "@mongez/fs";
import { loadMigrationsFiles } from "../console/commands/database/migrate";
import { loadSeedsFiles } from "../console/commands/database/seeds";
import { warlockPath } from "../utils/paths";
import {
  createAppBuilder,
  createBootstrapFile,
  globModuleDirectory,
} from "./app-builder";
import { createConfigLoader } from "./config-loader-builder";

export async function buildCliApp() {
  const { addImport, saveAs } = createAppBuilder();

  await ensureDirectoryAsync(warlockPath());

  const command = process.argv[2];

  // to make the development process is faster, we will check for this certain command and add only the needed imports
  if (command === "dev") {
    const { addImport, saveAs, addContent } = createAppBuilder();

    addImport(
      `import { startConsoleApplication, $registerBuiltInCommands } from "@warlock.js/core"`,
    );

    addContent(`
async function main() {
  await $registerBuiltInCommands();
  startConsoleApplication();
}

main();
    `);

    await saveAs("cli");

    return warlockPath("cli.ts");
  }

  const initialImports = [createBootstrapFile(), createConfigLoader()];

  const optionalImports: any[] = [];

  const lastImports = [createCliApplicationStarter()];

  if (command.includes("migrate")) {
    optionalImports.push(loadMigrationsFiles());
  } else if (command.includes("seed")) {
    optionalImports.push(loadSeedsFiles());
  } else {
    lastImports.push(loadCommandFiles());
  }

  const list = [...initialImports, ...optionalImports, ...lastImports];

  const data = await Promise.all(list);

  addImport(...data);

  await saveAs("cli");

  return warlockPath("cli.ts");
}

export async function createCliApplicationStarter() {
  const { addImport, addContent, saveAs } = createAppBuilder();

  addImport(
    `import { startConsoleApplication, $registerBuiltInCommands } from "@warlock.js/core"`,
  );

  addContent(`
async function main() {
    await $registerBuiltInCommands();
    startConsoleApplication();
}

main();
`);

  await saveAs("start-console-application");

  return `import "./start-console-application"`;
}

export async function loadCommandFiles() {
  const { addImport, saveAs } = createAppBuilder();

  const paths = await globModuleDirectory("commands");

  const addCliImport = (path: string) => {
    return addImport(`import "${path}";`);
  };

  await Promise.all(paths.map(async path => await addCliImport(path)));

  await saveAs("commands");

  return `import "./commands"`;
}
