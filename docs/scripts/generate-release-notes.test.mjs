import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildReleaseNotes } from "./generate-release-notes.mjs";

test("builds the notes JSON from summary files, oldest first", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-notes-gen-"));
  try {
    writeFileSync(join(dir, "5.10.0-summary.md"), "# ten\n");
    writeFileSync(join(dir, "5.9.0-summary.md"), "﻿# nine\n");
    writeFileSync(join(dir, "notes.md"), "ignored");

    const data = await buildReleaseNotes(
      dir,
      { "5.10.0": { publishedAt: "2026-11-01T00:00:00.000Z" } },
      "now",
    );

    assert.equal(data.generatedAt, "now");
    assert.equal(data.latest, "5.10.0");
    assert.deepEqual(data.releases, [
      { version: "5.9.0", summary: "# nine\n" },
      { version: "5.10.0", publishedAt: "2026-11-01T00:00:00.000Z", summary: "# ten\n" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
