import { parentPort, workerData } from "node:worker_threads";
import { OxlintRunner, type OxlintFile } from "../oxlint-runner";

type WorkerMessage =
  | { type: "init"; config: { cwd: string } }
  | { type: "check"; files: OxlintFile[] }
  | { type: "filesDeleted"; files: OxlintFile[] }
  | { type: "shutdown" };

const runner = new OxlintRunner();
process.once("exit", () => runner.shutdown());
parentPort?.once("close", () => runner.shutdown());
parentPort?.on("message", async (message: WorkerMessage) => {
  try {
    switch (message.type) {
      case "init":
        parentPort?.postMessage({ type: "initialized", ...runner.initialize(message.config.cwd) });
        break;
      case "check":
        parentPort?.postMessage({
          type: "results",
          results: await runner.checkFiles(message.files),
        });
        break;
      case "filesDeleted":
        // The CLI reads current disk contents and holds no persistent file cache.
        break;
      case "shutdown":
        runner.shutdown();
        process.exit(0);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("Oxlint Health Checker:", detail);
    parentPort?.postMessage({ type: "error", message: detail });
  }
});

const data = workerData as { autoInit?: boolean; cwd?: string } | undefined;
if (data?.autoInit) runner.initialize(data.cwd ?? process.cwd());
