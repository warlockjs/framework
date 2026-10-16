import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("root formatter catches drift, applies shared style and preserves changelog BOM", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-oxfmt-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "example.ts");
  const changelog = path.join(directory, "CHANGELOG.md");
  const run = (mode) =>
    spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/oxfmt/bin/oxfmt"),
        "--config",
        path.join(root, ".oxfmtrc.json"),
        "--ignore-path",
        path.join(root, ".oxfmtignore"),
        mode,
        file,
        changelog,
      ],
      { cwd: root, encoding: "utf8" },
    );
  writeFileSync(file, "export const identity=value=>{return 'hello'}\n");
  writeFileSync(changelog, "\uFEFF# Changelog\n\n- example\n");
  assert.equal(run("--check").status, 1);
  const formatted = run("--write");
  assert.equal(formatted.status, 0, formatted.stderr);
  assert.match(readFileSync(file, "utf8"), /\(value\) =>/);
  assert.match(readFileSync(file, "utf8"), /return "hello";/);
  assert.ok(
    readFileSync(changelog)
      .subarray(0, 3)
      .equals(Buffer.from([0xef, 0xbb, 0xbf])),
  );
  const clean = run("--check");
  assert.equal(clean.status, 0, clean.stderr);
});
