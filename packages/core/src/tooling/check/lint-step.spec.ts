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
  it("retains explicitly selected ESLint with one deprecation warning on stderr", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = app();
    for (let i = 0; i < 2; i++) {
      const result = await runLint(root, ["src/test.js"], "eslint");
      expect(result.linters).toEqual(["eslint"]);
      expect(result.problems).toMatchObject([{ source: "eslint", rule: "no-debugger", line: 1 }]);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("5.34.0");
    expect(warn.mock.calls[0]?.[0]).toContain("npx warlock upgrade --from 5.32 --to 5.33.0");
  });
  it("reports a missing explicitly selected ESLint config", async () => {
    const root = app();
    rmSync(path.join(root, "eslint.config.mjs"));
    expect((await runLint(root, ["src/test.js"], "eslint")).problems).toMatchObject([
      { code: "WL8002" },
    ]);
  });
});
