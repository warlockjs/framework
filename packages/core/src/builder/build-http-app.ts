import { ensureDirectoryAsync, putFileAsync } from "@mongez/fs";
import { transpile } from "../esbuild/transpile";
import { warlockPath } from "../utils/paths";
import {
  createAppBuilder,
  createBootstrapFile,
  createEnvironmentModeDisplayFile,
  loadEventFiles,
  loadLocalesFiles,
  loadMainFiles,
  loadRoutesFiles,
} from "./app-builder";
import { createConfigLoader } from "./config-loader-builder";

type ModuleBuilder = () => Promise<string>;

// Order matters: bootstrap and environment must be first
const moduleBuilders: Record<string, ModuleBuilder> = {
  bootstrap: createBootstrapFile,
  environment: createEnvironmentModeDisplayFile,
  config: createConfigLoader,
  main: loadMainFiles,
  locales: loadLocalesFiles,
  events: loadEventFiles,
  routes: loadRoutesFiles,
  starter: createHttpApplicationStarter,
};

export async function buildHttpApp() {
  await ensureDirectoryAsync(warlockPath());

  // First, build all modules and save their outputs
  for (const [name, builder] of Object.entries(moduleBuilders)) {
    try {
      // Execute the builder and get its output
      await builder();

      // The builder functions now handle their own saving
      // We just need to transpile the saved file
      await transpile(warlockPath(`${name}.ts`), `${name}.js`);
    } catch (error) {
      console.error(`Failed to build module ${name}:`, error);
      throw error;
    }
  }

  // Create the main entry point that imports all modules in order
  const mainEntryContent = `
// Load environment first
import "./bootstrap";
import "./environment";

// Load config before other modules
import "./config";

// Load core modules
import "./main";
import "./locales";
import "./events";
import "./routes";

// Start the application
import "./starter";

// Export a timestamp to ensure the file is not cached
export const timestamp = ${Date.now()};`;

  const mainEntry = warlockPath("http.ts");
  await putFileAsync(mainEntry, mainEntryContent);

  return mainEntry;
}

export async function createHttpApplicationStarter() {
  const { addImport, addContent, saveAs } = createAppBuilder();

  addImport(`import { startHttpApplication } from "@warlock.js/core"`);

  addContent(`startHttpApplication();`);

  await saveAs("start-http-application");

  return `import "./start-http-application"`;
}
