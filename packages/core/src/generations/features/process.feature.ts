import { srcPath } from "../../utils";
import { fileExistsAsync, getFileAsync, putFileAsync, recordSkippedFile } from "../generation-fs";
import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

const processConfig = `import { rootPath } from "@warlock.js/core";
import type { SupervisorOptions } from "@warlock.js/process";

const processConfig = {
  owner: "app",
  registry: rootPath("storage/processes/registry.json"),
  defaults: { timeoutMs: 300_000, memoryBytes: 512 * 1024 * 1024 },
} satisfies SupervisorOptions;

export default processConfig;
`;

const processes = `import { supervisor } from "@warlock.js/process";
import processConfig from "../../config/process";

export const processes = supervisor(processConfig);
`;

const lifecycle = `import { Application } from "@warlock.js/core";
import { processes } from "./index";

Application.onValidateBoot(async () => {
  await processes.recover();
});
Application.onShutdown(async () => {
  await processes.stopAll();
});
`;

async function createOnce(file: string, content: string): Promise<void> {
  if (await fileExistsAsync(file)) {
    recordSkippedFile(file, "exists");
    return;
  }
  await putFileAsync(file, content);
}

export const processFeature: FeatureDefinition = {
  description:
    "App-owned processes and terminals; creates typed config, recovery and graceful shutdown hooks, and a development process panel.",
  dependencies: { "@warlock.js/process": INSTALLED_WARLOCK_VERSION },
  ejectConfig: { name: "process", content: processConfig },
  async onExecuting() {
    await createOnce(srcPath("app/processes/index.ts"), processes);
    await createOnce(srcPath("app/processes/lifecycle.ts"), lifecycle);
    const main = srcPath("app/main.ts");
    const content = (await fileExistsAsync(main)) ? await getFileAsync(main) : "";
    if (!/import\s*["']\.\/processes\/lifecycle["']/.test(content)) {
      await putFileAsync(main, `import "./processes/lifecycle";\n${content}`);
    } else recordSkippedFile(main, "exists");
    // Devtools discovers this source only in development and only when installed.
    await createOnce(
      srcPath("app/processes/devtools.ts"),
      `import { processes } from "./index";

export const processPanel = { list: () => processes.list() };
`,
    );
    console.log(
      "Process supervision configured. Next: set a unique owner and registry per app instance in src/config/process.ts, then import { processes } from your app/processes module and await processes.spawn(...). Install devtools with warlock add devtools to view the Processes panel. Install node-pty separately for spawnPty(). macOS also needs the shipped identity helper compiled and WARLOCK_PROCESS_IDENTITY_HELPER configured; see the process package README.",
    );
  },
};
