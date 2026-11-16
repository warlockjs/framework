import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createTypingsProgress } from "./typings-progress";

const require = createRequire(import.meta.url);

/** Far above a run on an empty project; far below the CI job limit. */
const RUN_BOUND_MS = 90_000;

describe("typings progress", () => {
  it("reports each stage start and end, and a heartbeat while one is slow", async () => {
    const lines: string[] = [];
    const progress = createTypingsProgress({
      write: (line) => lines.push(line),
      heartbeatMs: 10,
    });

    await progress.stage("slow work", () => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(lines[0]).toBe("generate.typings: slow work…");
    expect(lines.some((line) => line.includes("still slow work after"))).toBe(true);
    expect(lines.at(-1)).toMatch(/slow work done in \d+ ms$/);
  });

  it("reports a failed stage and rethrows", async () => {
    const write = vi.fn();
    const progress = createTypingsProgress({ write });

    await expect(progress.stage("broken", () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(write).toHaveBeenLastCalledWith(expect.stringContaining("broken failed after"));
  });
});

/**
 * The reported hang on Windows cannot be reproduced on the machines that
 * investigated it. This spec runs the command's action in a child Node process
 * on an empty project, bounded by a timeout, so every CI platform settles
 * whether the standalone command returns by itself.
 */
describe("warlock generate.typings in a child process", () => {
  it("finishes by itself on an empty project and writes the typings", async () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "warlock-typings-"));
    const scriptDirectory = mkdtempSync(path.join(os.tmpdir(), "warlock-typings-script-"));

    try {
      mkdirSync(path.join(project, "src", "config"), { recursive: true });
      writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "fixture" }));
      writeFileSync(path.join(project, "src", "config", "app.ts"), "export default {};\n");

      const command = pathToFileURL(path.join(__dirname, "typings-generator.command.ts")).href;
      const script = path.join(scriptDirectory, "run.mts");

      writeFileSync(
        script,
        `import { typingsGeneratorCommand } from ${JSON.stringify(command)};\n` +
          "await typingsGeneratorCommand.commandAction?.({ options: {}, args: [] } as never);\n" +
          "console.error('generate.typings: action returned');\n",
      );

      const tsx = require.resolve("tsx/cli");
      const result = await new Promise<{ code: number | null; output: string; timedOut: boolean }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, [tsx, script], {
            cwd: project,
            env: { ...process.env, NODE_ENV: "test" },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          });
          let output = "";
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
          }, RUN_BOUND_MS);

          child.stdout.on("data", (chunk) => (output += chunk));
          child.stderr.on("data", (chunk) => (output += chunk));
          child.on("error", reject);
          child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, output, timedOut });
          });
        },
      );

      expect(result.timedOut, result.output).toBe(false);
      expect(result.output).toContain("generate.typings: action returned");
      expect(result.output).toContain("connector typings done");
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(scriptDirectory, { recursive: true, force: true });
    }
  }, 120_000);
});
