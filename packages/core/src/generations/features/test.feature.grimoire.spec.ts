import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const written = new Map<string, string>();
let manifest = "{}";

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async () => false),
  getFileAsync: vi.fn(async () => manifest),
  putFileAsync: vi.fn(async (path: string, content: string) => {
    written.set(path, content);
  }),
}));

import { testFeature } from "./test.feature";

function viteConfig(): string {
  return [...written.entries()].find(([path]) => /vite\.config\.ts$/.test(path))?.[1] ?? "";
}

describe("add test — Grimoire reporter in the generated vite.config.ts", () => {
  beforeEach(() => {
    written.clear();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds grimoireReporter() when the app depends on @warlock.js/grimoire", async () => {
    manifest = '{ "dependencies": { "@warlock.js/grimoire": "5.55.0" } }';

    await testFeature.onExecuting?.({} as never);

    expect(viteConfig()).toContain(
      'reporters: ["default", new TestSetupReporter(), grimoireReporter()]',
    );
    expect(viteConfig()).toContain(
      'import { grimoireReporter } from "@warlock.js/grimoire/vitest";',
    );
  });

  it("leaves the reporter out when the app does not use Grimoire", async () => {
    manifest = '{ "dependencies": {} }';

    await testFeature.onExecuting?.({} as never);

    expect(viteConfig()).not.toContain("grimoire");
  });
});
