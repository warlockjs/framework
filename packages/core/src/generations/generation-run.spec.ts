import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileExistsAsync, getFileAsync, putFileAsync, recordSkippedFile } from "./generation-fs";
import {
  type GenerationReport,
  beginGenerationRun,
  endGenerationRun,
  runGenerationCommand,
} from "./generation-run";

let tempDir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "warlock-generation-run-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  endGenerationRun({ ok: true });
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("generation-fs outside a run", () => {
  it("writes straight to disk", async () => {
    await putFileAsync(path.join(tempDir, "a.txt"), "hello");

    expect(await readFile(path.join(tempDir, "a.txt"), "utf8")).toBe("hello");
  });
});

describe("a dry run", () => {
  it("writes nothing, but later reads in the same run see the previewed content", async () => {
    beginGenerationRun({ command: "add", dryRun: true });

    const target = path.join(tempDir, "src", "config", "tests.ts");

    await putFileAsync(target, "export default {};\n");

    expect(existsSync(target)).toBe(false);
    expect(await fileExistsAsync(target)).toBe(true);
    expect(await getFileAsync(target)).toBe("export default {};\n");

    const report = endGenerationRun({ ok: true });

    expect(report.dryRun).toBe(true);
    expect(report.written).toEqual(["src/config/tests.ts"]);
    expect(report.files).toEqual([{ path: "src/config/tests.ts", type: "create" }]);
  });

  it("reports an edit of an existing file as update, identical content as unchanged, and skips with their reason", async () => {
    await writeFile(path.join(tempDir, "package.json"), "{}");
    await writeFile(path.join(tempDir, "same.txt"), "same");

    beginGenerationRun({ command: "add", dryRun: true });

    await putFileAsync(path.join(tempDir, "package.json"), '{"scripts":{}}');
    await putFileAsync(path.join(tempDir, "same.txt"), "same");
    recordSkippedFile(path.join(tempDir, "src", "config", "cache.ts"), "exists");

    const report = endGenerationRun({ ok: true });

    expect(await readFile(path.join(tempDir, "package.json"), "utf8")).toBe("{}");
    expect(report.files).toEqual([
      { path: "package.json", type: "update" },
      { path: "same.txt", type: "unchanged" },
      { path: "src/config/cache.ts", type: "skip", reason: "exists" },
    ]);
    expect(report.written).toEqual(["package.json"]);
    expect(report.skipped).toEqual([{ path: "src/config/cache.ts", reason: "exists" }]);
  });

  it("keeps a file created earlier in the run as create when it is edited again", async () => {
    beginGenerationRun({ command: "make endpoint", dryRun: true });

    const target = path.join(tempDir, "routes.ts");

    await putFileAsync(target, "a");
    await putFileAsync(target, "a\nb");

    expect(endGenerationRun({ ok: true }).files).toEqual([{ path: "routes.ts", type: "create" }]);
  });
});

describe("runGenerationCommand --json", () => {
  function captureStdout(): { output: () => string } {
    let output = "";

    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    });

    return { output: () => output };
  }

  it("prints exactly one JSON report on stdout and sends the command's own output to stderr", async () => {
    const stdout = captureStdout();
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runGenerationCommand(
      "make endpoint",
      { args: [], options: { json: true, dryRun: true } },
      async () => {
        console.log("✓ previewing");
        await putFileAsync(path.join(tempDir, "src", "app", "posts", "routes.ts"), "x");
      },
    );

    const lines = stdout.output().trim().split("\n");

    expect(lines).toHaveLength(1);

    const report = JSON.parse(lines[0] ?? "") as GenerationReport;

    expect(report).toMatchObject({
      schemaVersion: 1,
      command: "make endpoint",
      dryRun: true,
      ok: true,
      written: ["src/app/posts/routes.ts"],
      skipped: [],
      messages: ["✓ previewing"],
    });
    expect(stderr).toHaveBeenCalledWith("✓ previewing");
    expect(existsSync(path.join(tempDir, "src"))).toBe(false);
  });

  it("still prints a report, with ok: false and the error, when the action throws", async () => {
    const stdout = captureStdout();

    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      runGenerationCommand("add", { args: [], options: { json: true } }, async () => {
        throw new Error("Feature nope is not allowed");
      }),
    ).rejects.toThrow("Feature nope is not allowed");

    const report = JSON.parse(stdout.output()) as GenerationReport;

    expect(report.ok).toBe(false);
    expect(report.error).toBe("Feature nope is not allowed");
  });

  it("restores console.log afterwards", async () => {
    captureStdout();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const before = console.log;

    await runGenerationCommand("add", { args: [], options: { json: true } }, async () => undefined);

    expect(console.log).toBe(before);
  });
});
