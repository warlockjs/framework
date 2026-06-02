import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateController } from "../../../src/cli/commands/generate/generators/controller.generator";
import { generateService } from "../../../src/cli/commands/generate/generators/service.generator";
import { setDryRun } from "../../../src/cli/commands/generate/utils/writer";
import type { CommandActionData } from "../../../src/cli/types";

/**
 * Behavior for the module-gated generators (controller / service / model /
 * repository / resource). They guard the write path with `moduleExists(module)`,
 * which checks a DIRECTORY path.
 *
 * `moduleExists` now uses `directoryExistsAsync` (path-resolver.ts), so when the
 * module folder is present the generator proceeds and writes the component.
 * The remaining `process.exit(1)` cases are genuine input errors — a missing
 * module segment or no name argument at all.
 */
const data = (args: string[], options: CommandActionData["options"] = {}): CommandActionData => ({
  args,
  options,
});

const appPathFor = (...segments: string[]) =>
  path.join(process.cwd(), "src", "app", ...segments);

class ProcessExitError extends Error {
  public constructor(public readonly code?: number) {
    super(`process.exit(${code})`);
  }
}

let tempDir: string;
let originalCwd: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "warlock-gate-"));
  process.chdir(tempDir);

  // Pre-create the module directory so the directory-existence gate passes and
  // the generators can write into the "users" module.
  await mkdir(appPathFor("users"), { recursive: true });

  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitError(code);
  }) as never);
});

afterEach(async () => {
  setDryRun(false);
  consoleSpy.mockRestore();
  exitSpy.mockRestore();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("module-gated generators — directory existence gate", () => {
  it("generateController writes the controller when the module directory exists", async () => {
    await expect(generateController(data(["users/create-user"]))).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();

    // The controllers folder now holds the generated file.
    await expect(readdir(appPathFor("users", "controllers"))).resolves.toContain(
      "create-user.controller.ts",
    );
  });

  it("generateService writes the service when the module directory exists", async () => {
    await expect(generateService(data(["users/create-user"]))).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();

    await expect(readdir(appPathFor("users", "services"))).resolves.toContain(
      "create-user.service.ts",
    );
  });

  it("exits when the input has no module segment", async () => {
    await expect(generateService(data(["create-user"]))).rejects.toBeInstanceOf(ProcessExitError);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when no name argument is supplied at all", async () => {
    await expect(generateController(data([]))).rejects.toBeInstanceOf(ProcessExitError);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
