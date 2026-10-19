// Load the actual TypeScript driver in a separate Node process, without a build
// or dependencies. Node 22.15 provides both synchronous hooks and transform mode:
// https://nodejs.org/download/release/v22.15.0/docs/api/module.html
import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@warlock.js/logger") {
      return {
        url: "data:text/javascript,export const log = { error: (...args) => console.error(...args) };",
        shortCircuit: true,
      };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      return {
        format: "module",
        shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), {
          mode: "transform",
          sourceUrl: url,
        }),
      };
    }
    return nextLoad(url, context);
  },
});

const { LocalDriver } = await import("../../src/drivers/local");
const { SqliteStore } = await import("../../src/drivers/sqlite-store");
const { registerJob } = await import("../../src/job-registry");
const config = JSON.parse(process.argv[2]);
const mode = process.argv[3];
const driver = new LocalDriver(new SqliteStore(config), config);
registerJob({
  name: "process.job",
  async handle(payload, context) {
    process.send?.({ type: "started", id: context.id, pid: process.pid, at: Date.now() });
    if (mode === "crash") await new Promise(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    return payload;
  },
});
await driver.start("process-queue");
process.send?.({ type: "ready", pid: process.pid });
