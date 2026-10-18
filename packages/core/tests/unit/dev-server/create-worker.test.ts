import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { createWorker } from "../../../src/dev-server/create-worker";

it("loads builtins through createRequire and later TypeScript imports in a source worker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "warlock-source-worker-"));
  try {
    await Promise.all([
      writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" })),
      writeFile(path.join(root, "value.ts"), "export const value: number = 42;"),
      writeFile(
        path.join(root, "worker.ts"),
        `import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
const require = createRequire(import.meta.url);
// Native dependencies such as OXC use unprefixed builtin names with createRequire.
const { readFileSync } = require("fs");
const { basename } = require("path");
parentPort.once("message", async () => {
  const { value } = await import("./value");
  parentPort.postMessage({
    value,
    name: basename(workerData.file),
    content: readFileSync(workerData.file, "utf8"),
  });
});`,
      ),
    ]);

    const worker = createWorker("./worker", pathToFileURL(path.join(root, "caller.ts")).href, {
      execArgv: [],
      env: { ...process.env, NODE_OPTIONS: "" },
      workerData: { file: path.join(root, "value.ts") },
    });
    try {
      const response = once(worker, "message");
      worker.postMessage({ type: "load" }, []);
      await expect(response).resolves.toEqual([
        { value: 42, name: "value.ts", content: "export const value: number = 42;" },
      ]);
    } finally {
      await worker.terminate();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
