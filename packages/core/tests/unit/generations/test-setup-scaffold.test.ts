import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandActionData } from "../../../src/commands/types";

/**
 * Filesystem doubles for the `warlock add test` scaffold.
 *
 * `fileExistsAsync` answers `false` so every emission branch runs, and
 * `putFileAsync` records what the generator actually produced. Nothing touches
 * the real disk: these specs assert on the EMITTED string, not on the
 * generator's source text.
 */
const fsMocks = vi.hoisted(() => ({
  putFileAsync: vi.fn(async () => undefined),
  fileExistsAsync: vi.fn(async () => false),
  ensureDirectoryAsync: vi.fn(async () => undefined),
  getFileAsync: vi.fn(async () => ""),
  getJsonFileAsync: vi.fn(async () => ({}) as Record<string, unknown>),
  putJsonFileAsync: vi.fn(async () => undefined),
}));

vi.mock("@warlock.js/fs", () => fsMocks);

const { featuresMap } = await import("../../../src/generations/add-command.action");

/**
 * Run the `test` feature's scaffold and return every file it emitted, keyed by
 * a forward-slashed path so the lookups below read the same on any platform.
 */
async function runTestScaffold(): Promise<Map<string, string>> {
  const onExecuting = featuresMap.test.onExecuting;

  if (!onExecuting) {
    throw new Error("the `test` feature no longer has an onExecuting scaffold");
  }

  await onExecuting({ args: ["test"], options: {} } as unknown as CommandActionData);

  const emitted = new Map<string, string>();

  for (const [filePath, content] of fsMocks.putFileAsync.mock.calls as unknown as [
    string,
    string,
  ][]) {
    emitted.set(filePath.replace(/\\/g, "/"), content);
  }

  return emitted;
}

/**
 * Read one emitted file by the path suffix the consuming app sees.
 */
function emittedFile(emitted: Map<string, string>, suffix: string): string {
  for (const [filePath, content] of emitted) {
    if (filePath.endsWith(suffix)) {
      return content;
    }
  }

  throw new Error(`the scaffold emitted no ${suffix}; emitted: ${[...emitted.keys()].join(", ")}`);
}

describe("proof 2 — the generated test setup preserves project config and pairs its lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.fileExistsAsync.mockResolvedValue(false);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("emits a bare `setupTest()` so `tests.connectors` still applies", async () => {
    const setupFile = emittedFile(await runTestScaffold(), "src/test-setup.ts");

    expect(setupFile).toContain("await setupTest();");
    // No `setupTest` call anywhere in the emitted file may carry an argument:
    // an explicit `connectors` value outranks `tests.connectors` config.
    expect(setupFile).not.toMatch(/setupTest\s*\(\s*[^)]/);
    expect(setupFile).not.toContain("connectors: true");
  });

  it("pairs the setup with an `afterAll(teardownTest)` registration", async () => {
    const setupFile = emittedFile(await runTestScaffold(), "src/test-setup.ts");

    expect(setupFile).toContain("afterAll(teardownTest);");
    expect(setupFile).toMatch(/import\s*\{\s*afterAll\s*\}\s*from\s*"vitest";/);
    expect(setupFile).toMatch(/teardownTest[^\n]*from "@warlock\.js\/core\/tests"/);
  });

  it("does not tell the reader the setup runs once per worker", async () => {
    const setupFile = emittedFile(await runTestScaffold(), "src/test-setup.ts");

    expect(setupFile).not.toMatch(/worker/i);
    expect(setupFile).toMatch(/EVERY test file/);
  });

  it("does not repeat the per-worker claim in the generated vite config", async () => {
    const viteConfig = emittedFile(await runTestScaffold(), "vite.config.ts");

    expect(viteConfig).toContain(`setupFiles: ["./src/test-setup.ts"]`);
    expect(viteConfig).not.toMatch(/runs per worker/i);
  });
});
