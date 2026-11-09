import { describe, expect, it } from "vitest";
import {
  environmentCodeOf,
  MAX_VITEST_ARGUMENT_CHARS,
  parseVitestReport,
  runVitestBatches,
  vitestArgumentBatches,
  type VitestRun,
  vitestArguments,
  vitestRunFailure,
} from "./tests-step";

/** A report in the shape vitest's `--reporter=json` writes (Jest-compatible). */
const report = {
  numTotalTests: 4,
  testResults: [
    {
      name: "/app/src/app/posts/publish.spec.ts",
      status: "failed",
      message: "",
      assertionResults: [
        { fullName: "publish sets the date", status: "passed", failureMessages: [] },
        {
          fullName: "publish rejects drafts",
          status: "failed",
          failureMessages: ["AssertionError: expected 200 to be 422\n    at publish.spec.ts:14:5"],
          location: { line: 12, column: 3 },
        },
        {
          fullName: "publish caches the post",
          status: "failed",
          failureMessages: ["Error: connect ECONNREFUSED 127.0.0.1:6379"],
        },
      ],
    },
    {
      name: "/app/src/app/users/users.spec.ts",
      status: "failed",
      message: "Failed to load url ../missing (resolved id: ../missing)",
      assertionResults: [],
    },
    { name: "/app/src/app/ok.spec.ts", status: "passed", message: "", assertionResults: [] },
  ],
};

describe("vitest report", () => {
  it("turns failed tests, failed files and environment failures into problems", () => {
    const problems = parseVitestReport(report, "/app");

    expect(
      problems.map((problem) => [problem.code, problem.file, problem.line, problem.rule]),
    ).toEqual([
      ["WL7301", "src/app/posts/publish.spec.ts", 12, "publish rejects drafts"],
      ["WL8003", "src/app/posts/publish.spec.ts", null, "publish caches the post"],
      ["WL7302", "src/app/users/users.spec.ts", null, null],
    ]);
    expect(problems[1]).toMatchObject({ category: "environment", source: "environment" });
    expect(problems[0]?.message).toContain("expected 200 to be 422");
  });

  it("classifies messages that show the machine", () => {
    expect(environmentCodeOf("connect ECONNREFUSED 127.0.0.1:5432")).toBe("WL8003");
    expect(environmentCodeOf("listen EADDRINUSE: address already in use :::3000")).toBe("WL8004");
    expect(environmentCodeOf("expected 1 to be 2")).toBeUndefined();
  });

  it("reports a run without a report as a crash or a load failure", () => {
    expect(
      vitestRunFailure({
        code: null,
        signal: "SIGKILL",
        stdout: "",
        stderr: "",
        report: undefined,
      })[0]?.code,
    ).toBe("WL8007");
    expect(
      vitestRunFailure({
        code: 1,
        signal: null,
        stdout: "",
        stderr: "Error: Cannot find module 'x'",
        report: undefined,
      })[0]?.code,
    ).toBe("WL7302");
  });

  it("runs the whole suite, or only the tests related to the changed files", () => {
    expect(vitestArguments(null)).toEqual(["run", "--passWithNoTests"]);
    expect(vitestArguments(["src/a.ts"])).toEqual([
      "related",
      "src/a.ts",
      "--run",
      "--passWithNoTests",
    ]);
  });
});

describe("batched vitest runs", () => {
  const files = Array.from(
    { length: 400 },
    (_, index) => `src/app/area/file-${index}-${"x".repeat(80)}.ts`,
  );
  const length = (args: readonly string[]) => args.reduce((sum, item) => sum + item.length + 1, 0);

  it("keeps a short list, and the whole suite, as one identical run", () => {
    expect(vitestArgumentBatches(null)).toEqual([vitestArguments(null)]);
    expect(vitestArgumentBatches(["src/a.ts", "src/b.ts"])).toEqual([
      vitestArguments(["src/a.ts", "src/b.ts"]),
    ]);
    expect(vitestArgumentBatches([])).toEqual([vitestArguments([])]);
  });

  it("splits a long list so each command line stays under the limit and no file is lost", () => {
    const batches = vitestArgumentBatches(files);

    expect(batches.length).toBeGreaterThan(1);

    for (const batch of batches) {
      expect(length(batch)).toBeLessThanOrEqual(MAX_VITEST_ARGUMENT_CHARS);
      expect(batch[0]).toBe("related");
      expect(batch.slice(-2)).toEqual(["--run", "--passWithNoTests"]);
    }

    expect(batches.flatMap((batch) => batch.filter((item) => item.endsWith(".ts")))).toEqual(files);
  });

  it("gives a single over-long file its own batch", () => {
    const batches = vitestArgumentBatches(
      ["a.ts", `${"b".repeat(100)}.ts`, "c.ts"],
      vitestArguments,
      50,
    );

    expect(batches.map((batch) => batch.filter((item) => item.endsWith(".ts")).length)).toEqual([
      1, 1, 1,
    ]);
  });

  it("merges the reports of the batches and the first failing exit code", async () => {
    const run = (name: string, code: number, tests: number): VitestRun => ({
      code,
      signal: null,
      stdout: "",
      stderr: "",
      report: {
        numTotalTests: tests,
        numFailedTests: code === 0 ? 0 : 1,
        success: code === 0,
        testResults: [{ name, status: code === 0 ? "passed" : "failed" }],
      },
    });
    const runs = [run("a", 0, 2), run("b", 1, 3)];
    const seen: string[][] = [];
    const merged = await runVitestBatches(
      async (_binary, args) => (seen.push([...args]), runs[seen.length - 1] as VitestRun),
      "vitest",
      [
        ["related", "a.ts"],
        ["related", "b.ts"],
      ],
      "/app",
    );

    expect(seen).toHaveLength(2);
    expect(merged.code).toBe(1);
    expect(merged.report).toMatchObject({ numTotalTests: 5, numFailedTests: 1, success: false });
    expect((merged.report as { testResults: unknown[] }).testResults).toHaveLength(2);
  });

  it("reports a batch that wrote no report instead of hiding the crash", async () => {
    const crashed: VitestRun = {
      code: 137,
      signal: null,
      stdout: "",
      stderr: "boom",
      report: undefined,
    };
    const ok: VitestRun = {
      code: 0,
      signal: null,
      stdout: "",
      stderr: "",
      report: { testResults: [] },
    };
    const queue = [ok, crashed];
    const merged = await runVitestBatches(
      async () => queue.shift() as VitestRun,
      "vitest",
      [["a"], ["b"]],
      "/app",
    );

    expect(merged).toBe(crashed);
  });
});
