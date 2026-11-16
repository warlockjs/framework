import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { ProofLine, ProofResult, TestResultsStore } from "../contracts/test-results";
import {
  checkTestResults,
  hashTestFile,
  mergeTestResults,
  readTestResults,
  writeTestResults,
} from "./index";

const NOW = new Date("2026-11-16T10:00:00.000Z");

function result(over: Partial<ProofResult> = {}): ProofResult {
  return {
    feature: "catalog",
    flow: "wishlist",
    criterion: "AC-1",
    testFile: "src/a.spec.ts",
    testName: "adds",
    line: 4,
    outcome: "pass",
    durationMs: 3,
    ranAt: "2026-11-16T09:00:00.000Z",
    testFileHash: "h1",
    ...over,
  };
}

function store(results: ProofResult[]): TestResultsStore {
  return { schemaVersion: 1, updatedAt: "2026-11-16T09:00:00.000Z", runner: "vitest", results };
}

describe("mergeTestResults", () => {
  it("starts a store from a run", () => {
    const merged = mergeTestResults(null, [result()], ["src/a.spec.ts"], NOW);

    expect(merged.schemaVersion).toBe(1);
    expect(merged.runner).toBe("vitest");
    expect(merged.updatedAt).toBe(NOW.toISOString());
    expect(merged.results).toHaveLength(1);
  });

  it("keeps the results of files the run did not cover", () => {
    const old = store([result({ testFile: "src/a.spec.ts" }), result({ testFile: "src/b.spec.ts", criterion: "AC-2" })]);
    const merged = mergeTestResults(old, [result({ outcome: "fail" })], ["src/a.spec.ts"], NOW);

    expect(merged.results.map((item) => [item.testFile, item.outcome])).toEqual([
      ["src/a.spec.ts", "fail"],
      ["src/b.spec.ts", "pass"],
    ]);
  });

  it("drops the old results of a file that ran with no proving test any more", () => {
    const old = store([result()]);

    expect(mergeTestResults(old, [], ["src/a.spec.ts"], NOW).results).toEqual([]);
  });

  it("replaces every old result of a re-run file, not only matching ones", () => {
    const old = store([result({ criterion: "AC-1" }), result({ criterion: "AC-2", line: 9 })]);
    const merged = mergeTestResults(old, [result({ criterion: "AC-1" })], ["src/a.spec.ts"], NOW);

    expect(merged.results.map((item) => item.criterion)).toEqual(["AC-1"]);
  });

  it("does not change its input and orders results the same way every time", () => {
    const old = store([result({ testFile: "src/z.spec.ts" })]);
    const copy = structuredClone(old);
    const merged = mergeTestResults(old, [result({ testFile: "src/a.spec.ts" })], ["src/a.spec.ts"], NOW);

    expect(old).toEqual(copy);
    expect(merged.results.map((item) => item.testFile)).toEqual(["src/a.spec.ts", "src/z.spec.ts"]);
  });
});

describe("read and write", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "grimoire-results-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads null when the file is absent, broken or not a store", async () => {
    expect(await readTestResults(root)).toBeNull();

    await mkdir(path.join(root, "grimoire/book"), { recursive: true });
    await writeFile(path.join(root, "grimoire/book/test-results.json"), "{nope");
    expect(await readTestResults(root)).toBeNull();

    await writeFile(path.join(root, "grimoire/book/test-results.json"), JSON.stringify({ hello: 1 }));
    expect(await readTestResults(root)).toBeNull();
  });

  it("writes the store atomically and reads it back", async () => {
    const value = store([result()]);

    await writeTestResults(root, value);

    expect(await readTestResults(root)).toEqual(value);
    expect(await readdir(path.join(root, "grimoire/book"))).toEqual(["test-results.json"]);
    expect((await readFile(path.join(root, "grimoire/book/test-results.json"), "utf8")).endsWith("\n")).toBe(true);
  });
});

describe("checkTestResults", () => {
  let root: string;
  const content = "// @proves catalog/wishlist AC-1\nit('adds', () => {});\n";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "grimoire-check-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/a.spec.ts"), content);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const proof: ProofLine = {
    feature: "catalog",
    flow: "wishlist",
    ref: "catalog/wishlist",
    criterion: "AC-1",
    test: { name: "adds", line: 2 },
    at: { file: "src/a.spec.ts", line: 1, column: null },
  };

  function snapshot(results: TestResultsStore | null, status = "shipped"): GrimoireSnapshot {
    return {
      root,
      written: { features: [{ flows: [{ ref: "catalog/wishlist", status: { value: status } }] }] },
      proofs: [proof],
      results,
    } as unknown as GrimoireSnapshot;
  }

  const hash = hashTestFile(content);

  it("reports nothing without results", () => {
    expect(checkTestResults(snapshot(null))).toEqual([]);
  });

  it("reports nothing for a passing, fresh result", () => {
    expect(checkTestResults(snapshot(store([result({ testFileHash: hash })])))).toEqual([]);
  });

  it("reports a failing proven test as GR4006 error", () => {
    const [finding] = checkTestResults(snapshot(store([result({ outcome: "fail", testFileHash: hash })])));

    expect(finding?.code).toBe("GR4006");
    expect(finding?.severity).toBe("error");
    expect(finding?.subject.flow).toBe("catalog/wishlist");
    expect(finding?.at?.file).toBe("src/a.spec.ts");
  });

  it("reports a result older than the test file as GR4007", () => {
    const [finding] = checkTestResults(snapshot(store([result({ testFileHash: "old" })])));

    expect(finding?.code).toBe("GR4007");
    expect(finding?.severity).toBe("warning");
  });

  it("reports a proof with no result, or a skipped one, as GR4008", () => {
    expect(checkTestResults(snapshot(store([])))[0]?.code).toBe("GR4008");
    expect(checkTestResults(snapshot(store([result({ outcome: "skip", testFileHash: hash })])))[0]?.code).toBe(
      "GR4008",
    );
  });

  it("marks findings of a proposed flow as expected", () => {
    const [finding] = checkTestResults(snapshot(store([result({ outcome: "fail", testFileHash: hash })]), "proposed"));

    expect(finding?.expected).toBe(true);
  });
});
