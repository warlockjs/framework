import { describe, expect, it } from "vitest";
import {
  environmentCodeOf,
  parseVitestReport,
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
