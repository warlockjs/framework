import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testRuntimeDefaults } from "./codemods/test-runtime";
import { UPGRADE_NOTES } from "./notes";
import { runUpgrade } from "./run-upgrade";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function app(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-upgrade-test-runtime-"));

  roots.push(root);

  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }

  return root;
}

const upgrade = (root: string) =>
  runUpgrade({
    root,
    from: "5.37.1",
    to: "5.38.0",
    codemods: [testRuntimeDefaults],
    dryRun: false,
  });

describe("codemod test-runtime-worker-lifetime", () => {
  it("points an app that boots per file at the opt-in settings, and edits nothing", async () => {
    const root = app({
      "src/config/tests.ts": "export default { fakes: { cache: false } };\n",
    });

    const result = await upgrade(root);

    expect(result.applied).toEqual([]);
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]).toMatchObject({ file: "src/config/tests.ts" });
    expect(result.manual[0]?.hint).toContain('lifetime: "worker"');
    expect(result.manual[0]?.hint).toContain("workerDatabaseName");
  });

  it("stays quiet once the app chose a lifetime", async () => {
    const root = app({
      "src/config/tests.ts": 'export default { lifetime: "file" };\n',
    });

    expect((await upgrade(root)).manual).toEqual([]);
  });

  it("lists a unit project without the guard", async () => {
    const root = app({
      "vite.config.ts": 'export default { test: { projects: [{ test: { name: "unit" } }] } };\n',
    });

    const result = await upgrade(root);

    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]?.hint).toContain("guardUnitProject()");
  });

  it("does not list a unit project that already has the guard", async () => {
    const root = app({
      "vite.config.ts":
        'import { guardUnitProject } from "@warlock.js/core/vite";\nexport default { test: { projects: [{ plugins: [guardUnitProject()], test: { name: "unit" } }] } };\n',
    });

    expect((await upgrade(root)).manual).toEqual([]);
  });
});

describe("5.38 upgrade note", () => {
  it("says existing apps keep their test configuration", () => {
    const note = UPGRADE_NOTES.find((entry) => entry.version === "5.38.0");

    expect(note?.text).toContain("existing");
    expect(note?.text).toContain("lifetime");
  });

  it("explains the clearMocks consequence for module-level calls in the 5.36 note", () => {
    const note = UPGRADE_NOTES.find((entry) => entry.version === "5.36.0");

    expect(note?.text).toContain("clearMocks");
    expect(note?.text).toMatch(/import/);
    expect(note?.text).toContain("clearMocks: false");
  });
});
