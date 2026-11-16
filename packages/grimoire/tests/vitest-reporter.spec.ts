import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startVitest } from "vitest/node";
import { afterAll, describe, expect, it } from "vitest";
import { readTestResults } from "../src/test-results";
import { grimoireReporter } from "../src/vitest";

// Runs the reporter in a tiny real Vitest run (Vitest's own node API) on a temp project.
const PASSING = ["// @proves catalog/wishlist AC-1", 'it("adds", () => { expect(1).toBe(1); });', ""].join("\n");
const FAILING = ["// @proves catalog/wishlist AC-2", 'it("removes", () => { expect(1).toBe(2); });', ""].join("\n");

async function run(root: string, filters: string[]): Promise<void> {
  const vitest = await startVitest("test", filters, {
    root,
    config: false,
    watch: false,
    globals: true,
    reporters: [grimoireReporter({ root })],
  });

  await vitest?.close();
}

describe("grimoireReporter in a real run", () => {
  let root = "";

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("records a passing and a failing proven test, and keeps results of files a later run skips", async () => {
    root = await mkdtemp(path.join(tmpdir(), "grimoire-real-run-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/pass.spec.ts"), PASSING);
    await writeFile(path.join(root, "src/fail.spec.ts"), FAILING);

    const exitCode = process.exitCode;

    await run(root, []);
    process.exitCode = exitCode;

    const first = await readTestResults(root);

    expect(first?.results.map((item) => [item.testFile, item.criterion, item.outcome])).toEqual([
      ["src/fail.spec.ts", "AC-2", "fail"],
      ["src/pass.spec.ts", "AC-1", "pass"],
    ]);
    expect(first?.results.every((item) => item.line === 2 && item.testFileHash.length === 64)).toBe(true);

    // A partial run of one file keeps the other file's result.
    await run(root, ["pass.spec"]);
    process.exitCode = exitCode;

    const second = await readTestResults(root);

    expect(second?.results.map((item) => item.outcome).sort()).toEqual(["fail", "pass"]);
  }, 60_000);
});
