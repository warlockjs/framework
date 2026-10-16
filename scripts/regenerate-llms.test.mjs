import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { regenerateLlms } from "./regenerate-llms.mjs";

function fixture(t, scripts) {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-llms-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(scripts)) {
    mkdirSync(path.join(root, name, "scripts"), { recursive: true });
    if (body !== null) writeFileSync(path.join(root, name, "scripts/generate-llms.mjs"), body);
  }
  return root;
}

test("regenerates every package reference from package cwd and is stable on reruns", (t) => {
  const script =
    'import { writeFileSync } from "node:fs"; writeFileSync("llms-full.txt", "current skill content");';
  const root = fixture(t, { z: script, a: script, noGenerator: null });
  assert.deepEqual(regenerateLlms(root), ["a", "z"]);
  assert.equal(readFileSync(path.join(root, "a/llms-full.txt"), "utf8"), "current skill content");
  assert.deepEqual(regenerateLlms(root), ["a", "z"]);
});

test("a failed generator stops before later packages and identifies the package", (t) => {
  const root = fixture(t, { a: "process.exit(7)", z: "" });
  assert.throws(() => regenerateLlms(root), /regenerate a.*exit 7/);
});
