// Runs the real TypeScript driver in a separate Node process. The spec forks this file with
// `--import tsx`, the same loader other packages use for TypeScript child processes; it
// also loads built-in modules such as node:sqlite normally.
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
