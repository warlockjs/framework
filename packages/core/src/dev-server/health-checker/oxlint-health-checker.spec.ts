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
import { FilesHealthcareManager } from "./files-healthcare.manager";
import { OxlintRunner, findOxlint, parseOxlintResults, oxlintCommandError } from "./oxlint-runner";

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
  it.each(["win32", "linux"] as const)(
    "batches a large boot scan by argv size on %s and merges diagnostics",
    async (platform) => {
      const calls: string[][] = [];
      let active = 0;
      let maxActive = 0;
      const execute = vi.fn(async (_binary: string, args: string[]) => {
        calls.push(args);
        maxActive = Math.max(maxActive, ++active);
        await Promise.resolve();
        active--;
        return {
          stdout: JSON.stringify({
            diagnostics: [
              {
                filename: args[4],
                severity: "warning",
                message: "batch diagnostic",
                code: "test-rule",
              },
            ],
          }),
          stderr: "",
        };
      });
      const batched = new OxlintRunner({ execute, exists: () => true, platform });
      batched.initialize(cwd);
      const files = Array.from({ length: 13_000 }, (_, index) => ({
        path: path.join(cwd, "src", `${"nested-module-".repeat(15)}${index}.ts`),
        relativePath: `src/file-${index}.ts`,
      }));
      const results = await batched.checkFiles(files);
      expect(calls.length).toBeGreaterThan(1);
      expect(maxActive).toBe(1);
      const argumentsSent = calls.flatMap((args) => args.slice(4));
      expect(argumentsSent).toEqual(files.map((file) => path.relative(cwd, file.path)));
      const limit = platform === "win32" ? 24 * 1024 : 512 * 1024;
      for (const args of calls) {
        expect(
          args.reduce(
            (sum, arg) =>
              sum + (platform === "win32" ? arg.length + 3 : Buffer.byteLength(arg) + 1),
            0,
          ),
        ).toBeLessThan(limit);
        expect(args.slice(4).some((arg) => path.isAbsolute(arg))).toBe(false);
      }
      expect(results).toHaveLength(files.length);
      expect(results.filter((result) => result.warnings.length)).toHaveLength(calls.length);
      expect(results.map((result) => result.path)).toEqual(files.map((file) => file.path));
    },
  );

  it.each([
    {
      stdout: "Failed to load oxlint.config.ts: TypeScript config requires a newer Node runtime",
      stderr: "",
      detail: "TypeScript config requires a newer Node runtime",
    },
    {
      stdout: "Failed to parse config: Rule eslint/unknown-rule not found",
      stderr: "",
      detail: "Rule eslint/unknown-rule not found",
    },
    {
      stdout: "not json",
      stderr: "invalid rule configuration",
      detail: "invalid rule configuration",
    },
  ])("reports actionable non-JSON tool output: $detail", async ({ stdout, stderr, detail }) => {
    const file = await write("changed.ts", "debugger;\n");
    const contextual = new OxlintRunner({ execute: async () => ({ stdout, stderr }) });
    contextual.initialize(cwd);
    await expect(contextual.checkFiles([file])).rejects.toThrow(
      `Oxlint could not check changed files: ${detail === stderr ? stderr : stdout}`,
    );
  });

  it("keeps stdout config errors alongside stderr warnings and preserves structured messages", async () => {
    const file = await write("changed.ts", "debugger;\n");
    const contextual = new OxlintRunner({
      execute: async () => ({
        stdout: "Rule unknown-rule not found",
        stderr: "ExperimentalWarning: Type Stripping",
      }),
    });
    contextual.initialize(cwd);
    await expect(contextual.checkFiles([file])).rejects.toThrow(
      /Type Stripping[\s\S]*unknown-rule not found/,
    );
    const structured = new OxlintRunner({
      execute: async () => ({
        stdout: JSON.stringify({
          diagnostics: [{ message: "configuration problem", severity: "error" }],
        }),
        stderr: "warning noise",
      }),
    });
    structured.initialize(cwd);
    await expect(structured.checkFiles([file])).rejects.toThrow("Oxlint: configuration problem");
  });

  it("bounds command failure diagnostics without exposing full command arguments", () => {
    const failure = Object.assign(new Error("Command failed: private-path".repeat(20000)), {
      code: "ETIMEDOUT",
      killed: true,
    });
    const message = oxlintCommandError(failure, "", "").message;
    expect(message).toContain("30s limit");
    expect(message).not.toContain("private-path");
    expect(message.length).toBeLessThan(200);
    expect(oxlintCommandError({ code: 2 }, "config error", "warning").message).toContain(
      "warning\nconfig error",
    );
  });

  it("includes the real CLI's unknown-rule configuration error in the failure message", async () => {
    await write(".oxlintrc.json", JSON.stringify({ rules: { "eslint/unknown-rule": "error" } }));
    const file = await write("changed.ts", "debugger;\n");
    await expect(runner.checkFiles([file])).rejects.toThrow(
      /Oxlint could not check changed files:.*Failed/s,
    );
  });

  it("retains ESLint checks when only its app configuration exists", async () => {
    await write("eslint.config.mjs", "export default [];\n");
    await fs.rm(path.join(cwd, "node_modules", "eslint"));
    expect(defaultHealthCheckers({}, cwd).map((checker) => checker.name)).toContain("ESLint");
  });

  it("returns file metadata and diagnostics without echoing serialized source contents", async () => {
    const file = { ...(await write("changed.ts", "debugger;\n")), content: "private file source" };
    const [checked] = await runner.checkFiles([file]);
    expect(checked).not.toHaveProperty("content");
    const [skipped] = await runner.checkFiles([{ ...file, path: path.join(cwd, "data.json") }]);
    expect(skipped).not.toHaveProperty("content");
  });

  it("terminates its running CLI child during shutdown", async () => {
    const fakeCwd = path.join(cwd, "shutdown");
    const fake = path.join(fakeCwd, "node_modules", "oxlint");
    await fs.mkdir(fake, { recursive: true });
    await fs.writeFile(path.join(fakeCwd, ".oxlintrc.json"), "{}");
    await fs.writeFile(
      path.join(fake, "package.json"),
      JSON.stringify({ name: "oxlint", bin: "cli.cjs" }),
    );
    const pidPath = path.join(fakeCwd, "child.pid");
    await fs.writeFile(
      path.join(fake, "cli.cjs"),
      `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000);`,
    );
    runner.initialize(fakeCwd);
    const file = await write("changed.ts", "debugger;\n");
    const pending = runner.checkFiles([file]);
    const rejected = expect(pending).rejects.toThrow("Oxlint could not check changed files");
    await vi.waitFor(async () => expect(await fs.readFile(pidPath, "utf8")).toMatch(/^\d+$/));
    const pid = Number(await fs.readFile(pidPath, "utf8"));
    runner.shutdown();
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it("manager shutdown lets the worker reap its running CLI child", async () => {
    const fake = path.join(cwd, "node_modules", "oxlint");
    await fs.rm(fake, { recursive: true, force: true });
    await fs.mkdir(fake, { recursive: true });
    await fs.writeFile(
      path.join(fake, "package.json"),
      JSON.stringify({ name: "oxlint", bin: "cli.cjs" }),
    );
    const pidPath = path.join(cwd, "manager-child.pid");
    await fs.writeFile(
      path.join(fake, "cli.cjs"),
      `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000);`,
    );
    const file = await write("changed.ts", "debugger;\n");
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const manager = new FilesHealthcareManager(
      new Map([
        [
          file.path,
          {
            absolutePath: file.path,
            relativePath: file.relativePath,
            content: "debugger;",
          } as unknown as FileManager,
        ],
      ]),
    );
    manager.setHealthCheckers([new OxlintHealthChecker()]);
    await manager.initialize();
    const checking = manager.validateAllFiles();
    let pid = 0;
    try {
      await vi.waitFor(async () => expect(await fs.readFile(pidPath, "utf8")).toMatch(/^\d+$/), {
        timeout: 10000,
      });
      pid = Number(await fs.readFile(pidPath, "utf8"));
      await manager.shutdown();
      await checking;
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    } finally {
      await manager.shutdown();
      if (pid) {
        try {
          process.kill(pid);
        } catch {}
      }
    }
  }, 15000);

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
