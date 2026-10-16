import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileManager } from "../file-manager";
import { createWorker } from "../create-worker";
import { OxlintHealthChecker } from "./checkers/oxlint-health-checker";
import { defaultHealthCheckers } from "./default-health-checkers";
import { OxlintRunner, findOxlint, parseOxlintResults } from "./oxlint-runner";

const require = createRequire(import.meta.url);
let cwd: string;
let runner: OxlintRunner;

async function write(name: string, contents: string) {
  const filePath = path.join(cwd, name);
  await fs.writeFile(filePath, contents);
  return { path: filePath, relativePath: name };
}

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "warlock-oxlint-"));
  await fs.mkdir(path.join(cwd, "node_modules"));
  await write("package.json", JSON.stringify({ type: "module" }));
  for (const name of ["oxlint", "eslint"]) {
    const packageDirectory = path.dirname(require.resolve(`${name}/package.json`));
    await fs.symlink(packageDirectory, path.join(cwd, "node_modules", name), "junction");
  }
  await write(
    ".oxlintrc.json",
    JSON.stringify({
      rules: { "no-debugger": "error", "no-unused-vars": "warn" },
      ignorePatterns: ["ignored.ts"],
    }),
  );
  runner = new OxlintRunner();
  runner.initialize(cwd);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(cwd, { recursive: true, force: true });
});

describe("Oxlint background file checks", () => {
  it("maps actual CLI errors, warnings and locations for changed fixture files only", async () => {
    const bad = await write("changed.ts", "const unused = 1;\ndebugger;\n");
    const good = await write("clean.ts", "export const value = 1;\n");
    expect(await runner.checkFiles([good])).toMatchObject([
      { healthy: true, errors: [], warnings: [] },
    ]);
    const [result] = await runner.checkFiles([bad, good]);
    expect(result).toMatchObject({
      path: bad.path,
      healthy: false,
      errors: [{ type: "error", ruleId: "eslint(no-debugger)", lineNumber: 2, columnNumber: 1 }],
      warnings: [
        {
          type: "warning",
          ruleId: "eslint(no-unused-vars)",
          lineNumber: 1,
          columnNumber: 7,
          length: 6,
        },
      ],
    });
    await write("changed.ts", "export const fixed = 1;\n");
    expect(await runner.checkFiles([bad])).toMatchObject([
      { healthy: true, errors: [], warnings: [] },
    ]);
  });

  it("skips absent tooling/config, unsupported files, deleted files and empty batches", async () => {
    const ignored = await write("ignored.ts", "debugger;\n");
    const json = await write("data.json", "{}");
    expect(
      await runner.checkFiles([
        ignored,
        json,
        { path: path.join(cwd, "deleted.ts"), relativePath: "deleted.ts" },
      ]),
    ).toMatchObject([{ healthy: true }, { healthy: true }, { healthy: true }]);
    expect(await runner.checkFiles([])).toEqual([]);
    await fs.rm(path.join(cwd, "node_modules", "oxlint"));
    expect(findOxlint(cwd)).toBeUndefined();
    expect(runner.initialize(cwd)).toEqual({ success: true, hasConfig: false });
    await fs.rm(path.join(cwd, ".oxlintrc.json"));
    expect(findOxlint(cwd)).toBeUndefined();
  });

  it("detects JSONC and TypeScript config filenames without loading them in the dev server", async () => {
    await fs.rm(path.join(cwd, ".oxlintrc.json"));
    for (const name of [".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts"]) {
      await write(name, "not executed by detection");
      expect(findOxlint(cwd)).toBeDefined();
      await fs.rm(path.join(cwd, name));
    }
  });

  it("supports inline FileHealthResult mapping for a custom checker array", async () => {
    const bad = await write("changed.ts", "debugger;\n");
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const checker = new OxlintHealthChecker().initialize();
    const result = await checker.check({
      absolutePath: bad.path,
      relativePath: bad.relativePath,
    } as FileManager);
    expect(result.getStats()).toEqual({ state: "defective", errors: 1, warnings: 0 });
  });

  it("runs ESLint and Oxlint together and honors individual switches", async () => {
    await write("eslint.config.mjs", "export default [];\n");
    expect(defaultHealthCheckers({}, cwd).map((checker) => checker.name)).toEqual([
      "TypeScript",
      "ESLint",
      "Oxlint",
    ]);
    expect(
      defaultHealthCheckers({ typescript: false, eslint: false, oxlint: true }, cwd).map(
        (checker) => checker.name,
      ),
    ).toEqual(["Oxlint"]);
    expect(defaultHealthCheckers({ oxlint: false }, cwd).map((checker) => checker.name)).toEqual([
      "TypeScript",
      "ESLint",
    ]);
    await fs.rm(path.join(cwd, "node_modules", "oxlint"));
    expect(defaultHealthCheckers({ typescript: false, eslint: false, oxlint: true }, cwd)).toEqual(
      [],
    );
  });

  it("rejects malformed reports and reports tool failures instead of inventing diagnostics", async () => {
    expect(() => parseOxlintResults("{}", [], cwd)).toThrow("invalid JSON diagnostics report");
    expect(() => parseOxlintResults("not json", [], cwd)).toThrow();
    const fakeCwd = path.join(cwd, "broken");
    const fake = path.join(fakeCwd, "node_modules", "oxlint");
    await fs.mkdir(fake, { recursive: true });
    await fs.writeFile(path.join(fakeCwd, ".oxlintrc.json"), "{}");
    await fs.writeFile(
      path.join(fake, "package.json"),
      JSON.stringify({ name: "oxlint", bin: "cli.cjs" }),
    );
    await fs.writeFile(
      path.join(fake, "cli.cjs"),
      "process.stderr.write('invalid config'); process.exit(2);",
    );
    runner.initialize(fakeCwd);
    const file = await write("file.ts", "debugger;\n");
    await expect(runner.checkFiles([file])).rejects.toThrow("invalid config");
  });

  it.each(["source", "published"])(
    "exchanges changed-file results with the %s worker",
    async (mode) => {
      const file = await write("changed.ts", "debugger;\n");
      let workerPath = "./workers/oxlint-health.worker";
      let baseUrl = import.meta.url;
      if (mode === "published") {
        await build({
          entryPoints: [new URL("./workers/oxlint-health.worker.ts", import.meta.url).pathname],
          outfile: path.join(cwd, "compiled-worker.mjs"),
          bundle: true,
          platform: "node",
          format: "esm",
        });
        workerPath = "./compiled-worker";
        baseUrl = pathToFileURL(path.join(cwd, "manager.mjs")).href;
      }
      const worker = createWorker(workerPath, baseUrl);
      function exchange(message: unknown): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            worker.off("message", onMessage);
            reject(new Error("worker response timeout"));
          }, 10_000);
          const onMessage = (response: Record<string, unknown>) => {
            clearTimeout(timer);
            resolve(response);
          };
          worker.once("message", onMessage);
          worker.once("error", reject);
          worker.postMessage(message);
        });
      }
      try {
        expect(await exchange({ type: "init", config: { cwd } })).toMatchObject({
          type: "initialized",
          success: true,
          hasConfig: true,
        });
        expect(await exchange({ type: "check", files: [file] })).toMatchObject({
          type: "results",
          results: [{ healthy: false, errors: [{ ruleId: "eslint(no-debugger)" }] }],
        });
        worker.postMessage({ type: "filesDeleted", files: [file] });
        const exited = new Promise<number>((resolve) => worker.once("exit", resolve));
        worker.postMessage({ type: "shutdown" });
        expect(await exited).toBe(0);
      } finally {
        await worker.terminate();
      }
    },
    15_000,
  );
});
