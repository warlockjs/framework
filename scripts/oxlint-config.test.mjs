import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shared oxlint config catches correctness errors and accepts a clean TypeScript module", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-oxlint-"));
  try {
    const file = path.join(directory, "example.ts");
    const run = () =>
      spawnSync(
        path.join(root, "node_modules/.bin/oxlint"),
        ["--config", path.join(root, ".oxlintrc.json"), "--format", "json", file],
        { encoding: "utf8", cwd: root },
      );
    writeFileSync(file, "const count = 0; count = 1; export { count };\n");
    const failing = run();
    assert.equal(failing.status, 1, failing.stderr);
    assert.match(failing.stdout, /no-const-assign/);
    writeFileSync(file, "export const count = 1;\n");
    const passing = run();
    assert.equal(passing.status, 0, passing.stderr);
    assert.deepEqual(JSON.parse(passing.stdout).diagnostics, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
