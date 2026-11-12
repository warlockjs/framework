import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * An app script that awaits a supervisor call at top level has nothing else
 * keeping Node alive. These specs run such a script in a fresh Node process: if a
 * pending observation holds no live handle, Node exits with code 13 ("unsettled
 * top-level await") before the call settles.
 */
const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
const source = (file: string) => pathToFileURL(path.join(sourceDirectory, file)).href;

/**
 * A stand-in for the PowerShell helper that answers after 300 ms. The specs start
 * it through the real spawn function, so the child and its pipes are unreferenced.
 */
const helper = [
  'const lines = require("node:readline").createInterface({ input: process.stdin });',
  'lines.on("line", (line) => {',
  "  const request = JSON.parse(line);",
  '  const rows = request.pids.map((pid) => ({ pid, parent: 1, start: "638000000000000010", rss: 1 }));',
  '  setTimeout(() => process.stdout.write(JSON.stringify({ id: request.id, rows }) + "\\n"), 300);',
  "});",
].join("\n");

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function runScript(
  body: string,
): Promise<{ code: number | null; stdout: string; stderr: string; directory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "warlock-process-host-"));
  directories.push(directory);
  const script = path.join(directory, "probe.mts");
  await writeFile(script, body, "utf8");
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", tsxLoader, script],
      { cwd: directory, timeout: 90_000, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error ? ((error as { code?: unknown }).code ?? null) : 0;
        resolve({
          code: typeof code === "number" ? code : null,
          stdout: String(stdout),
          stderr: String(stderr),
          directory,
        });
      },
    );
  });
}

describe("host process stays alive while a call is pending", () => {
  it("settles a helper query awaited at top level even though the helper is unreferenced", async () => {
    const result = await runScript(
      [
        `import { defaultHelperSpawn, WindowsProcessHelper } from ${JSON.stringify(source("windows-helper.ts"))};`,
        `const script = ${JSON.stringify(helper)};`,
        "const helper = new WindowsProcessHelper({ spawn: () => defaultHelperSpawn(process.execPath, ['-e', script]) });",
        "const rows = await helper.query([4242]);",
        "console.log(JSON.stringify(rows.map((row) => row.pid)));",
        "await helper.close();",
      ].join("\n"),
    );
    expect(result.stderr).not.toContain("unsettled top-level await");
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("[4242]");
  }, 100_000);

  it("lets the host exit once the answer arrives, without closing the helper", async () => {
    const startedAt = Date.now();
    const result = await runScript(
      [
        `import { defaultHelperSpawn, WindowsProcessHelper } from ${JSON.stringify(source("windows-helper.ts"))};`,
        `const script = ${JSON.stringify(helper)};`,
        // A long answer timeout: a timer left behind after the reply would hold the host for a minute.
        "const helper = new WindowsProcessHelper({ timeoutMs: 60_000, spawn: () => defaultHelperSpawn(process.execPath, ['-e', script]) });",
        "await helper.query([4242]);",
        "console.log('done');",
      ].join("\n"),
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("done");
    expect(Date.now() - startedAt).toBeLessThan(30_000);
  }, 100_000);

  it("settles recover() awaited at top level with an empty recovery when the registry file does not exist", async () => {
    const result = await runScript(
      [
        `import { supervisor } from ${JSON.stringify(source("index.ts"))};`,
        "const registry = new URL('./registry/processes.json', import.meta.url);",
        "const { fileURLToPath } = await import('node:url');",
        "const processes = supervisor({ owner: 'host-exit-probe', registry: fileURLToPath(registry) });",
        "console.log(JSON.stringify(await processes.recover()));",
        "await processes.stopAll();",
      ].join("\n"),
    );
    expect(result.stderr).not.toContain("unsettled top-level await");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ adopted: [], stopped: [], cleared: [] });
    const saved: unknown = JSON.parse(
      await readFile(path.join(result.directory, "registry", "processes.json"), "utf8"),
    );
    expect(saved).toEqual({ version: 1, owner: "host-exit-probe", entries: [] });
  }, 100_000);
});
