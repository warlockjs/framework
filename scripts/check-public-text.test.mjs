import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { findPublicTextIssues, assertPublicTextClean } from "./check-public-text.mjs";

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "public-text-"));
  roots.push(root);
  mkdirSync(path.join(root, "packages/example"), { recursive: true });
  mkdirSync(path.join(root, "docs/src"), { recursive: true });
  return root;
}

test("reports internal identifiers and configured names with precise locations", () => {
  const root = fixture();
  writeFileSync(
    path.join(root, "packages/example/CHANGELOG.md"),
    "Changes\nWR-029 and FW-12\nprivate-demo\n",
  );
  writeFileSync(path.join(root, "docs/src/guide.md"), "PRIVATE-DEMO\n");
  const issues = findPublicTextIssues(root, ["private-demo"]);
  assert.equal(issues.length, 4);
  assert.ok(
    issues.some((issue) => issue.file === "packages/example/CHANGELOG.md" && issue.line === 2),
  );
  assert.throws(() => assertPublicTextClean(root, ["private-demo"]), /public text/i);
});

test("ignores dependency/build directories, binaries and partial identifier matches", () => {
  const root = fixture();
  for (const directory of ["node_modules", "dist"]) {
    mkdirSync(path.join(root, "packages/example", directory));
    writeFileSync(path.join(root, "packages/example", directory, "generated.md"), "WR-029");
  }
  writeFileSync(
    path.join(root, "packages/example/image.bin"),
    Buffer.from([0, ...Buffer.from("WR-029")]),
  );
  writeFileSync(
    path.join(root, "packages/example/README.md"),
    "XWR-029 WR-1 WR-1234 private-demo-extra",
  );
  assert.deepEqual(findPublicTextIssues(root, ["another-app"]), []);
});

test("treats configured names literally and matches case insensitively", () => {
  const root = fixture();
  writeFileSync(path.join(root, "docs/src/guide.md"), "a+b A+B ab");
  assert.equal(findPublicTextIssues(root, ["a+b"]).length, 2);
});

test("fails when a required scan root is missing", () => {
  const root = fixture();
  rmSync(path.join(root, "docs"), { recursive: true });
  assert.throws(() => findPublicTextIssues(root), /ENOENT/);
});
