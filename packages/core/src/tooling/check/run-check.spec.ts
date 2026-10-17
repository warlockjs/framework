import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProblem } from "../problem";
import type { TypecheckResult } from "../typecheck/run-typecheck";
import type { GitRunner } from "./changed-files";
import { listChangedFiles } from "./changed-files";
import { CHECK_EXIT_CODES, checkExitCode } from "./check-report.types";
import { checkNodeVersion, MIN_NODE_VERSION, minimumOfRange } from "./environment-step";
import { runCheck } from "./run-check";

let root: string;

function write(relative: string, source = "export {};\n"): void {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

function typecheckResult(problems: TypecheckResult["problems"] = []): TypecheckResult {
  return {
    ok: problems.length === 0,
    mode: "program",
    files: null,
    checkedFiles: 2,
    problems,
    durationMs: 1,
    buildInfoFile: null,
  };
}

const typeError = createProblem({
  code: "WL7101",
  source: "typescript",
  message: "Type 'string' is not assignable to type 'number'.",
  file: "src/app/posts/a.ts",
  line: 1,
  column: 7,
  rule: "TS2322",
});

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-check-"));
  write("package.json", JSON.stringify({ name: "shop" }));
  write("src/app/posts/a.ts");
  write("src/app/posts/b.ts", 'import "./routes";\n');
  write("src/app/posts/routes.ts");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("check exit codes", () => {
  it("is 0 clean or with warnings only, 1 for code problems, 2 once the machine is involved", () => {
    const warning = createProblem({
      code: "WL7202",
      source: "eslint",
      severity: "warning",
      message: "w",
    });
    const machine = createProblem({
      code: "WL8003",
      source: "environment",
      message: "ECONNREFUSED",
    });

    expect(checkExitCode([])).toBe(CHECK_EXIT_CODES.ok);
    expect(checkExitCode([warning])).toBe(0);
    expect(checkExitCode([typeError, warning])).toBe(1);
    expect(checkExitCode([typeError, machine])).toBe(2);
    expect(checkExitCode([machine])).toBe(2);
  });
});

describe("runCheck", () => {
  it("runs every step and reports one problem per finding, in step order", async () => {
    const report = await runCheck({
      cwd: root,
      typecheck: () => typecheckResult([typeError]),
      vitestBinary: null,
      nodeVersion: "22.15.0",
    });

    expect(report.steps.map((step) => [step.name, step.status])).toEqual([
      ["environment", "passed"],
      ["typecheck", "failed"],
      ["lint", "skipped"],
      ["tests", "skipped"],
      ["conventions", "failed"],
    ]);
    expect(report.problems.map((problem) => problem.code)).toEqual(["WL7101", "WL9001"]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      ok: false,
      exitCode: 1,
      changed: false,
      files: null,
      summary: { errors: 2, warnings: 0, code: 2, environment: 0 },
    });
  });

  it("exits 2 when a test fails because a service is unreachable", async () => {
    const vitest = vi.fn(async () => ({
      code: 1,
      signal: null,
      stdout: "",
      stderr: "",
      report: {
        numTotalTests: 1,
        testResults: [
          {
            name: path.join(root, "src/app/posts/a.spec.ts"),
            status: "failed",
            assertionResults: [
              {
                fullName: "a caches",
                status: "failed",
                failureMessages: ["connect ECONNREFUSED 127.0.0.1:6379"],
              },
            ],
          },
        ],
      },
    }));

    const report = await runCheck({
      cwd: root,
      skip: ["conventions"],
      typecheck: () => typecheckResult(),
      vitestBinary: "/fake/vitest.mjs",
      vitest,
      nodeVersion: "22.15.0",
    });

    expect(vitest).toHaveBeenCalledWith("/fake/vitest.mjs", ["run", "--passWithNoTests"], root);
    expect(report.steps.find((step) => step.name === "tests")).toMatchObject({
      status: "blocked",
      detail: "1 test(s) ran",
    });
    expect(report.steps.find((step) => step.name === "conventions")?.status).toBe("skipped");
    expect(report.exitCode).toBe(2);
    expect(report.summary.environment).toBe(1);
  });

  it("reports test files without vitest installed as a missing tool", async () => {
    write("src/app/posts/a.spec.ts");

    const report = await runCheck({
      cwd: root,
      skip: ["typecheck", "conventions"],
      vitestBinary: null,
      nodeVersion: "22.15.0",
    });

    expect(report.problems.map((problem) => problem.code)).toEqual(["WL8002"]);
    expect(report.exitCode).toBe(2);
  });

  it("limits every step to the changed files, and passes them to typecheck and vitest", async () => {
    const git: GitRunner = async (args) => ({
      code: 0,
      stderr: "",
      stdout: args[0] === "diff" ? "src/app/posts/b.ts\nREADME.md\n" : "src/app/posts/new.ts\n",
    });
    write("src/app/posts/new.ts");

    const typecheck = vi.fn(() => typecheckResult());
    const vitest = vi.fn(async () => ({
      code: 0,
      signal: null,
      stdout: "",
      stderr: "",
      report: { numTotalTests: 0, testResults: [] },
    }));

    const report = await runCheck({
      cwd: root,
      changed: true,
      git,
      typecheck,
      vitest,
      vitestBinary: "/fake/vitest.mjs",
      nodeVersion: "22.15.0",
    });

    expect(report.files).toEqual(["src/app/posts/b.ts", "src/app/posts/new.ts"]);
    expect(typecheck).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: root, files: ["src/app/posts/b.ts", "src/app/posts/new.ts"] }),
    );
    expect(vitest).toHaveBeenCalledWith(
      "/fake/vitest.mjs",
      ["related", "src/app/posts/b.ts", "src/app/posts/new.ts", "--run", "--passWithNoTests"],
      root,
    );
    // Only b.ts imports an auto-loaded file; a.ts was not changed and is not read.
    expect(report.problems.map((problem) => [problem.code, problem.file])).toEqual([
      ["WL9001", "src/app/posts/b.ts"],
    ]);
  });

  it("blocks the other steps when git cannot list the changed files", async () => {
    const report = await runCheck({
      cwd: root,
      changed: true,
      git: async () => ({ code: 128, stdout: "", stderr: "fatal: not a git repository" }),
      typecheck: () => typecheckResult(),
      nodeVersion: "22.15.0",
    });

    expect(report.steps.map((step) => step.status)).toEqual([
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
    ]);
    expect(report.problems).toEqual([
      expect.objectContaining({
        code: "WL8006",
        message: expect.stringContaining("not a git repository"),
      }),
    ]);
    expect(report.exitCode).toBe(2);
  });

  it("turns a step that throws into a WL8007 environment problem", async () => {
    const report = await runCheck({
      cwd: root,
      skip: ["conventions", "tests"],
      typecheck: () => {
        throw new Error("JavaScript heap out of memory");
      },
      nodeVersion: "22.15.0",
    });

    expect(report.problems[0]).toMatchObject({ code: "WL8007", category: "environment" });
    expect(report.steps.find((step) => step.name === "typecheck")?.status).toBe("blocked");
  });
});

describe("environment step", () => {
  it("requires the core minimum and the app's own >= engines range", () => {
    expect(checkNodeVersion(root, "22.15.0")).toEqual([]);
    expect(checkNodeVersion(root, "22.14.0")[0]).toMatchObject({ code: "WL8001" });

    write("package.json", JSON.stringify({ engines: { node: ">=24.1" } }));

    expect(checkNodeVersion(root, "22.15.0")[0]?.message).toContain("engines.node >=24.1");
    expect(minimumOfRange("^22 || ^24")).toBeUndefined();
  });

  it("keeps the minimum in step with core's engines.node", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
    );

    expect(`>=${MIN_NODE_VERSION.replace(/\.0$/, "")}`).toBe(manifest.engines.node);
  });
});

describe("listChangedFiles", () => {
  it("diffs against the merge base with --base and keeps existing source files", async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push([...args]);

      if (args[0] === "merge-base") return { code: 0, stdout: "abc123\n", stderr: "" };
      if (args[0] === "diff")
        return { code: 0, stdout: "src/app/posts/a.ts\nsrc/gone.ts\n", stderr: "" };

      return { code: 0, stdout: "", stderr: "" };
    };

    expect(await listChangedFiles({ cwd: root, base: "main", git })).toEqual({
      files: ["src/app/posts/a.ts"],
    });
    expect(calls).toEqual([
      ["merge-base", "main", "HEAD"],
      ["diff", "--name-only", "--relative", "--diff-filter=ACMR", "abc123"],
      ["ls-files", "--others", "--exclude-standard"],
    ]);
  });
});
