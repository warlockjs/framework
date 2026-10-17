import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTests, testRunArguments } from "./run-tests";
import type { VitestRunner } from "./tests-step";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-run-tests-"));

  roots.push(root);

  return root;
}

function fakeVitest(report: unknown, calls: string[][]): VitestRunner {
  return async (_binary, args) => {
    calls.push([...args]);
    return { code: 0, signal: null, stdout: "", stderr: "", report };
  };
}

describe("runTests", () => {
  it("runs test files directly and source files through vitest related", () => {
    expect(testRunArguments(["src/a.spec.ts", "src/b.test.tsx"])).toEqual([
      "run",
      "src/a.spec.ts",
      "src/b.test.tsx",
      "--passWithNoTests",
    ]);
    expect(testRunArguments(["src/a.ts"])).toEqual([
      "related",
      "src/a.ts",
      "--run",
      "--passWithNoTests",
    ]);
    expect(testRunArguments(null)).toEqual(["run", "--passWithNoTests"]);
  });

  it("reports totals and failures as WL7301 problems", async () => {
    const cwd = project();
    const calls: string[][] = [];
    const report = await runTests({
      cwd,
      files: [path.join(cwd, "src/posts.spec.ts")],
      vitestBinary: "/fake/vitest.mjs",
      vitest: fakeVitest(
        {
          numTotalTests: 2,
          numPassedTests: 1,
          numFailedTests: 1,
          testResults: [
            {
              name: path.join(cwd, "src/posts.spec.ts"),
              status: "failed",
              assertionResults: [
                {
                  status: "failed",
                  fullName: "posts lists",
                  failureMessages: ["expected 1 to be 2"],
                },
              ],
            },
          ],
        },
        calls,
      ),
    });

    expect(calls).toEqual([["run", "src/posts.spec.ts", "--passWithNoTests"]]);
    expect(report).toMatchObject({
      ok: false,
      exitCode: 1,
      mode: "files",
      files: ["src/posts.spec.ts"],
      total: 2,
      passed: 1,
      failed: 1,
      problems: [{ code: "WL7301", file: "src/posts.spec.ts", rule: "posts lists" }],
    });
  });

  it("scopes to changed files and skips the run when nothing changed", async () => {
    const cwd = project();
    const calls: string[][] = [];
    const report = await runTests({
      cwd,
      changed: true,
      git: async () => ({ code: 0, stdout: "", stderr: "" }),
      vitestBinary: "/fake/vitest.mjs",
      vitest: fakeVitest({}, calls),
    });

    expect(report).toMatchObject({ ok: true, mode: "changed", files: [], total: 0 });
    expect(calls).toEqual([]);
  });

  it("reports a git failure as an environment problem", async () => {
    const report = await runTests({
      cwd: project(),
      changed: true,
      git: async () => ({ code: 128, stdout: "", stderr: "not a git repository" }),
      vitestBinary: "/fake/vitest.mjs",
    });

    expect(report).toMatchObject({ ok: false, exitCode: 2, problems: [{ code: "WL8006" }] });
  });

  it("passes when the app has neither vitest nor tests", async () => {
    await expect(runTests({ cwd: project(), vitestBinary: null })).resolves.toMatchObject({
      ok: true,
      mode: "all",
    });
  });
});
