import glob from "fast-glob";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { setAppModuleImporter } from "../loader/app-module-importer";
import type { AppModuleImporter } from "../loader/app-module-importer";
import { router } from "../router/router";
import { rootPath, srcPath } from "../utils/paths";
import { timeTestStep } from "./test-runtime-scope";

/** `src/app/<module>/routes.ts(x)` and `src/app/**\/main.ts(x)` found on disk. */
async function appModuleEntriesOnDisk(): Promise<string[]> {
  return glob(["app/*/routes.{ts,tsx}", "app/main.{ts,tsx}", "app/*/main.{ts,tsx}"], {
    cwd: srcPath(),
    ignore: ["**/*.spec.*", "**/*.test.*"],
  });
}

/**
 * Discover the project's modules, classify them and import them, then remember
 * the resulting route table as the state a worker returns to between files.
 *
 * Discovery is read from the project at the current working directory, never
 * from a list built earlier: the files orchestrator only classifies files
 * (routes, main, events, ...) when asked, so the classification is refreshed
 * here after the files were read. A load that ends with no route or main file
 * in a project that has them on disk throws, naming what it saw, instead of
 * serving an empty application.
 */
export async function loadTestAppModules(
  importModule: AppModuleImporter | undefined,
): Promise<void> {
  setAppModuleImporter(importModule);

  try {
    await filesOrchestrator.init();
    await filesOrchestrator.initializeAll();
    filesOrchestrator.specialFilesCollector.collect(filesOrchestrator.files);

    const collector = filesOrchestrator.specialFilesCollector;
    const onDisk = await appModuleEntriesOnDisk();
    const found = collector.getFilesByType("route").length + collector.getFilesByType("main").length;

    if (onDisk.length > 0 && found === 0) {
      throw new Error(
        `createTestHttpServer({ loadAppModules: true }) found no route or main files, but ` +
          `${srcPath()} has ${onDisk.length} (${onDisk.slice(0, 3).join(", ")}${onDisk.length > 3 ? ", ..." : ""}). ` +
          `Project root: ${rootPath()}; files read by the orchestrator: ${filesOrchestrator.files.size}. ` +
          "Run the tests from the project root (the directory holding src/ and package.json).",
      );
    }

    await timeTestStep("appModules", () => filesOrchestrator.moduleLoader.loadAll());
    // The application's own routes are now part of the state a worker-scoped
    // runtime returns to between files.
    router.captureBootSnapshot();
  } finally {
    setAppModuleImporter(undefined);
  }
}
