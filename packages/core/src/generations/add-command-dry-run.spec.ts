import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execSync: exec,
}));

import { addCommandAction } from "./add-command.action";
import { type GenerationReport, runGenerationCommand } from "./generation-run";

const PACKAGE_JSON = `${JSON.stringify({ name: "app", dependencies: {}, devDependencies: {} }, null, 2)}\n`;

let tempDir: string;
let originalCwd: string;
let stdout: string[];

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "warlock-add-dry-run-"));
  process.chdir(tempDir);
  await writeFile(path.join(tempDir, "package.json"), PACKAGE_JSON);
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  exec.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

const report = () => JSON.parse(stdout.join("")) as GenerationReport;

describe("warlock add --dry-run --json", () => {
  it("lists the files and dependencies it would add, installs nothing and writes nothing", async () => {
    await runGenerationCommand(
      "add",
      { args: ["test"], options: { dryRun: true, json: true } },
      addCommandAction,
    );

    const result = report();

    expect(exec).not.toHaveBeenCalled();
    expect(await readFile(path.join(tempDir, "package.json"), "utf8")).toBe(PACKAGE_JSON);
    expect(existsSync(path.join(tempDir, "src"))).toBe(false);
    expect(existsSync(path.join(tempDir, "vite.config.ts"))).toBe(false);

    expect(result).toMatchObject({ ok: true, dryRun: true, command: "add" });
    expect(result.written).toEqual(
      expect.arrayContaining([
        "package.json",
        "src/test-global-setup.ts",
        "src/test-setup.ts",
        "vite.config.ts",
      ]),
    );
    expect(Object.keys(result.details.devDependencies as Record<string, string>)).toContain(
      "vitest",
    );
    expect(result.details.scripts).toMatchObject({ test: "vitest run" });
  });

  it("reports files that already exist as skipped", async () => {
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "test-setup.ts"), "// mine\n");

    await runGenerationCommand(
      "add",
      { args: ["test"], options: { dryRun: true, json: true } },
      addCommandAction,
    );

    expect(report().skipped).toContainEqual({ path: "src/test-setup.ts", reason: "exists" });
    expect(await readFile(path.join(tempDir, "src", "test-setup.ts"), "utf8")).toBe("// mine\n");
  });

  it("--list --json puts the feature catalog in the report", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    await expect(
      runGenerationCommand(
        "add",
        { args: [], options: { list: true, json: true } },
        addCommandAction,
      ),
    ).rejects.toThrow("exit");

    expect(exit).toHaveBeenCalledWith(0);
    // The exit listener never fired (process.exit was stubbed), so the thrown
    // stand-in produced the report; the catalog is in it either way.
    const features = report().details.features as Array<{ name: string }>;

    expect(features.map((feature) => feature.name)).toContain("test");
  });
});
