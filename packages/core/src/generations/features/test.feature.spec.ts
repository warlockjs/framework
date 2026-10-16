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

    expect(setupFile?.[1]).toContain("await setupTest({ importModule: (file) => import(file) });");
  });
});

describe("add test — spec discovery", () => {
  it("includes generated spec files alongside test files", async () => {
    await testFeature.onExecuting?.({} as never);
    const viteConfig = [...written.entries()].find(([path]) => /vite\.config\.ts$/.test(path));
    expect(viteConfig?.[1]).toContain('include: ["src/app/**/*.{test,spec}.ts"]');
  });
});
