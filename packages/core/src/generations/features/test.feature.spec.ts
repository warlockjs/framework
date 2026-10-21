import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const written = new Map<string, string>();

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async () => false),
  putFileAsync: vi.fn(async (path: string, content: string) => {
    written.set(path, content);
  }),
}));

import { testFeature } from "./test.feature";

describe("add test — generated src/test-setup.ts", () => {
  beforeEach(() => {
    written.clear();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes importModule so app modules share the test's module graph", async () => {
    await testFeature.onExecuting?.({} as never);

    const setupFile = [...written.entries()].find(([path]) => /test-setup\.ts$/.test(path));

    expect(setupFile?.[1]).toContain(
      "await setupTest({ importModule: (file) => import(file), file: expect.getState().testPath });",
    );
  });
});

describe("add test — generated src/test-runner.ts", () => {
  beforeEach(() => {
    written.clear();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extends Vitest 5's TestRunner from the main entry, which no longer ships vitest/runners", async () => {
    await testFeature.onExecuting?.({} as never);

    const runner = [...written.entries()].find(([path]) => /test-runner\.ts$/.test(path))?.[1];

    expect(runner).toContain('import { TestRunner } from "vitest";');
    expect(runner).toContain("extends TestRunner");
    expect(runner).toContain("this.onCleanupWorkerContext?.(cleanup)");
    expect(runner).not.toContain("vitest/runners");
  });

  it("declares vite 8 and vitest 5 for the app", () => {
    expect(testFeature.devDependencies).toMatchObject({
      vite: "^8.3.3",
      vitest: "^5.0.3",
      "@vitest/coverage-v8": "^5.0.3",
    });
  });
});

describe("add test — spec discovery", () => {
  it("includes generated spec files alongside test files", async () => {
    await testFeature.onExecuting?.({} as never);
    const viteConfig = [...written.entries()].find(([path]) => /vite\.config\.ts$/.test(path));
    expect(viteConfig?.[1]).toContain('name: "unit"');
    expect(viteConfig?.[1]).toContain('include: ["src/**/*.spec.ts"]');
    expect(viteConfig?.[1]).toContain('name: "integration"');
    expect(viteConfig?.[1]).toContain('"src/**/*.test.ts"');
    expect(viteConfig?.[1]).toContain("recommendedTestWorkers()");
    expect(viteConfig?.[1]).toContain("new TestSetupReporter()");
    expect(viteConfig?.[1]).toContain('runner: "./src/test-runner.ts"');
  });
});
