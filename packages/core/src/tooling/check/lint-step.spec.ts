import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLint } from "./lint-step";

const roots: string[] = [];
function app() {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-lint-default-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  writeFileSync(
    path.join(root, "eslint.config.mjs"),
    'export default [{ rules: { "no-debugger": "error" } }];\n',
  );
  writeFileSync(path.join(root, "src/test.js"), "debugger;\n");
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("lint selection", () => {
  it("does not discover ESLint implicitly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await runLint(app(), ["src/test.js"])).toEqual({ linters: [], problems: [] });
    expect(warn).not.toHaveBeenCalled();
  });
  it("reports a missing Oxlint package when its config exists", async () => {
    const root = app();
    writeFileSync(path.join(root, ".oxlintrc.json"), "{}");
    expect((await runLint(root, ["src/test.js"])).problems).toMatchObject([{ code: "WL8002" }]);
  });
});
