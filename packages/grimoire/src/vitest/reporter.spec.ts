import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashTestFile, readTestResults } from "../test-results";
import { grimoireReporter } from "./index";

// A stand-in for the proof scanner: the line under `// @proves f/fl AC-n` is the test.
vi.mock("../proves", () => ({
  scanProofsInText(text: string, file: string) {
    const lines = text.split("\n");
    const proofs = [];

    for (let index = 0; index < lines.length; index += 1) {
      const match = /^\/\/ @proves ([\w-]+)\/([\w-]+) (AC-\d+)$/.exec(lines[index] ?? "");

      if (!match) continue;

      const name = /it\("([^"]+)"/.exec(lines[index + 1] ?? "")?.[1] ?? null;

      proofs.push({
        feature: match[1],
        flow: match[2],
        ref: `${match[1]}/${match[2]}`,
        criterion: match[3],
        test: { name, line: index + 2 },
        at: { file, line: index + 1, column: null },
      });
    }

    return { proofs, findings: [] };
  },
}));

type State = "passed" | "failed" | "skipped" | "pending";

function testCase(name: string, line: number | undefined, state: State, duration = 5) {
  return {
    name,
    fullName: `suite > ${name}`,
    location: line === undefined ? undefined : { line, column: 1 },
    result: () => ({ state }),
    diagnostic: () => ({ duration }),
  };
}

function testModule(moduleId: string, tests: ReturnType<typeof testCase>[], state = "passed") {
  return { moduleId, state: () => state, children: { allTests: () => tests } };
}

const SPEC = ['// @proves catalog/wishlist AC-1', 'it("adds", () => {});', "", '// @proves catalog/wishlist AC-2', 'it("removes", () => {});', ""].join("\n");

describe("grimoireReporter", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "grimoire-reporter-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/a.spec.ts"), SPEC);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("records pass and fail per criterion with the file hash", async () => {
    const reporter = grimoireReporter({ root });
    const module = testModule(path.join(root, "src/a.spec.ts"), [
      testCase("adds", 2, "passed", 7),
      testCase("removes", 5, "failed"),
    ]);

    await reporter.onTestRunEnd?.([module], [], "passed");

    const store = await readTestResults(root);

    expect(store?.results.map((item) => [item.criterion, item.outcome, item.line])).toEqual([
      ["AC-1", "pass", 2],
      ["AC-2", "fail", 5],
    ]);
    expect(store?.results[0]).toMatchObject({
      testFile: "src/a.spec.ts",
      testName: "suite > adds",
      durationMs: 7,
      testFileHash: hashTestFile(SPEC),
    });
  });

  it("matches by test name when the run has no task locations", async () => {
    const reporter = grimoireReporter({ root });

    await reporter.onTestRunEnd?.(
      [testModule(path.join(root, "src/a.spec.ts"), [testCase("adds", undefined, "passed")])],
      [],
      "passed",
    );

    expect((await readTestResults(root))?.results.map((item) => item.criterion)).toEqual(["AC-1"]);
  });

  it("sets includeTaskLocation and reads the root from Vitest", async () => {
    const reporter = grimoireReporter();
    const config = { root, includeTaskLocation: false };

    reporter.onInit?.({ config });
    expect(config.includeTaskLocation).toBe(true);

    await reporter.onTestRunEnd?.(
      [testModule(path.join(root, "src/a.spec.ts"), [testCase("adds", 2, "passed")])],
      [],
      "passed",
    );

    expect((await readTestResults(root))?.results).toHaveLength(1);
  });

  it("merges a partial run without erasing the results of other files", async () => {
    await writeFile(path.join(root, "src/b.spec.ts"), SPEC);
    const reporter = grimoireReporter({ root });

    await reporter.onTestRunEnd?.(
      [testModule(path.join(root, "src/a.spec.ts"), [testCase("adds", 2, "passed"), testCase("removes", 5, "passed")])],
      [],
      "passed",
    );
    await reporter.onTestRunEnd?.(
      [testModule(path.join(root, "src/b.spec.ts"), [testCase("adds", 2, "failed")])],
      [],
      "failed",
    );

    const store = await readTestResults(root);

    expect(store?.results.map((item) => [item.testFile, item.criterion, item.outcome])).toEqual([
      ["src/a.spec.ts", "AC-1", "pass"],
      ["src/a.spec.ts", "AC-2", "pass"],
      ["src/b.spec.ts", "AC-1", "fail"],
    ]);
  });

  it("keeps the last real result when a filter skips the test", async () => {
    const reporter = grimoireReporter({ root });
    const file = path.join(root, "src/a.spec.ts");

    await reporter.onTestRunEnd?.([testModule(file, [testCase("adds", 2, "passed")])], [], "passed");
    await reporter.onTestRunEnd?.([testModule(file, [testCase("adds", 2, "skipped")])], [], "passed");

    expect((await readTestResults(root))?.results[0]?.outcome).toBe("pass");
  });

  it("does not touch results of a file whose run did not finish", async () => {
    const file = path.join(root, "src/a.spec.ts");
    const reporter = grimoireReporter({ root });

    await reporter.onTestRunEnd?.([testModule(file, [testCase("adds", 2, "passed")])], [], "passed");
    await reporter.onTestRunEnd?.([testModule(file, [testCase("adds", 2, "pending")])], [], "interrupted");

    expect((await readTestResults(root))?.results[0]?.outcome).toBe("pass");
  });

  it("warns once and never throws when the store cannot be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // `grimoire` is a file, so the book folder cannot be created.
    await writeFile(path.join(root, "grimoire"), "not a folder");

    const reporter = grimoireReporter({ root });
    const file = path.join(root, "src/a.spec.ts");

    await expect(reporter.onTestRunEnd?.([testModule(file, [testCase("adds", 2, "passed")])], [], "passed")).resolves.toBeUndefined();
    await reporter.onTestRunEnd?.([testModule(file, [testCase("adds", 2, "passed")])], [], "passed");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("[grimoire]");
  });

  it("writes nothing when no test file finished", async () => {
    const reporter = grimoireReporter({ root });

    await reporter.onTestRunEnd?.([], [], "passed");

    expect(await readTestResults(root)).toBeNull();
  });
});
