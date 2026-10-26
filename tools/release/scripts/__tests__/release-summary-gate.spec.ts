import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { assertReleaseSummaryExists, releaseSummaryPaths } from "../release-summary-gate.ts";
import { runReleaseFamily, type ReleaseFamilyDependencies } from "../release-family.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(files: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "release-summary-"));
  roots.push(root);
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), "# summary\n");
  }
  return root;
}

describe("assertReleaseSummaryExists", () => {
  it("passes when the summary and its packaged copy exist", async () => {
    const repoRoot = repository([
      "releases/5.38.1-summary.md",
      "packages/core/releases/5.38.1-summary.md",
    ]);
    await assertReleaseSummaryExists("5.38.1", { repoRoot });
  });

  it("refuses a version with no summary, naming both files", async () => {
    const repoRoot = repository(["releases/5.38.0-summary.md"]);
    await assert.rejects(
      assertReleaseSummaryExists("5.38.1", { repoRoot }),
      (error: Error) =>
        /Refusing to release 5\.38\.1/.test(error.message) &&
        error.message.includes("releases/5.38.1-summary.md") &&
        error.message.includes("packages/core/releases/5.38.1-summary.md"),
    );
  });

  it("refuses when only the packaged copy is missing", async () => {
    const repoRoot = repository(["releases/5.38.1-summary.md"]);
    await assert.rejects(
      assertReleaseSummaryExists("5.38.1", { repoRoot }),
      (error: Error) =>
        error.message.includes("packages/core/releases/5.38.1-summary.md") &&
        !error.message.includes("  - releases/5.38.1-summary.md"),
    );
  });

  it("builds the paths from the version", () => {
    const paths = releaseSummaryPaths("5.38.1", path.resolve("repo"));
    assert.equal(paths.source, path.resolve("repo", "releases", "5.38.1-summary.md"));
    assert.equal(
      paths.packaged,
      path.resolve("repo", "packages", "core", "releases", "5.38.1-summary.md"),
    );
  });
});

describe("release gate summary step", () => {
  it("stops the gate before any build when the summary is missing", async () => {
    const commands: string[][] = [];
    const dependencies: ReleaseFamilyDependencies = {
      loadFamily: async () => ({ name: "warlock", version: "5.38.1", members: [] }) as never,
      removeFile: async () => undefined,
      makeDirectory: async () => undefined,
      runCommand: async (request) => {
        commands.push([...request.args]);
        return { stdout: "", stderr: "" };
      },
      assertReleaseSummary: (version) =>
        assertReleaseSummaryExists(version, { repoRoot: repository([]) }),
    };

    await assert.rejects(
      runReleaseFamily(
        { mode: "gate", version: "5.38.1", matrixScope: "none" } as never,
        dependencies,
      ),
      /release summary is missing/,
    );
    assert.ok(commands.some((args) => args[0]?.endsWith("scripts/sync-release-notes.mjs")));
    assert.ok(!commands.some((args) => args[0]?.endsWith("scripts/regenerate-llms.mjs")));
    assert.ok(!commands.some((args) => args.includes("build")));
  });
});
