import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  assertReleaseNotesInSync,
  compareReleaseNotes,
  syncReleaseNotes,
} from "./sync-release-notes.mjs";

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture(source, packaged) {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-notes-sync-"));
  roots.push(root);
  mkdirSync(path.join(root, "releases"), { recursive: true });
  mkdirSync(path.join(root, "packages/core/releases"), { recursive: true });
  for (const [name, text] of Object.entries(source))
    writeFileSync(path.join(root, "releases", name), text);
  for (const [name, text] of Object.entries(packaged))
    writeFileSync(path.join(root, "packages/core/releases", name), text);
  return root;
}

test("reports missing, stale and extra copies", () => {
  const root = fixture(
    { "5.1.0-summary.md": "a", "5.2.0-summary.md": "b", "notes.md": "ignored" },
    { "5.2.0-summary.md": "old", "5.0.0-summary.md": "x" },
  );
  assert.deepEqual(compareReleaseNotes(root), {
    missing: ["5.1.0-summary.md"],
    stale: ["5.2.0-summary.md"],
    extra: ["5.0.0-summary.md"],
  });
  assert.throws(() => assertReleaseNotesInSync(root), /out of sync/);
});

test("sync makes the package copy identical", () => {
  const root = fixture({ "5.1.0-summary.md": "a" }, { "5.0.0-summary.md": "x" });
  syncReleaseNotes(root);
  assert.equal(
    readFileSync(path.join(root, "packages/core/releases/5.1.0-summary.md"), "utf8"),
    "a",
  );
  assertReleaseNotesInSync(root);
});
