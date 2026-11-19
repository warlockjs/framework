import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitRunner } from "./changed-files";
import { runCheck } from "./run-check";
import { findReusableResult, readTestRecord, treeHash, writeTestRecord } from "./test-reuse";
import { testTimeoutMs, type VitestRun, vitestRunFailure } from "./tests-step";

let root: string;

const git: GitRunner = async () => ({
  code: 0,
  stdout: "package.json\0pnpm-lock.yaml\0src/a.ts\0",
  stderr: "",
});

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-reuse-"));
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "node_modules"));
  writeFileSync(path.join(root, "package.json"), "{}");
  writeFileSync(path.join(root, "pnpm-lock.yaml"), "lock: 1");
  writeFileSync(path.join(root, "src/a.ts"), "export const a = 1;");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("tree hash", () => {
  it("changes with file content and the lockfile", async () => {
    const before = await treeHash(root, git);

    writeFileSync(path.join(root, "pnpm-lock.yaml"), "lock: 2");

    expect((await treeHash(root, git))?.hash).not.toBe(before?.hash);
  });

  it("is null when git cannot list the files", async () => {
    expect(await treeHash(root, async () => ({ code: 128, stdout: "", stderr: "x" }))).toBeNull();
  });
});

describe("tree hash, beyond what git lists", () => {
  it("changes with an ignored .env file at the project root", async () => {
    writeFileSync(path.join(root, ".env"), "A=1");
    const before = await treeHash(root, git);

    writeFileSync(path.join(root, ".env"), "A=2");

    expect((await treeHash(root, git))?.hash).not.toBe(before?.hash);
  });

  it("changes with a linked package outside the app", async () => {
    const other = mkdtempSync(path.join(os.tmpdir(), "warlock-linked-"));

    try {
      writeFileSync(path.join(other, "package.json"), '{"version":"1.0.0"}');
      symlinkSync(other, path.join(root, "node_modules", "linked-dep"));
      const before = await treeHash(root, git);

      writeFileSync(path.join(other, "package.json"), '{"version":"1.0.1"}');

      expect((await treeHash(root, git))?.hash).not.toBe(before?.hash);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("reusable result", () => {
  it("is found for the same tree and not after the tree changes", async () => {
    const tree = (await treeHash(root, git))!;

    writeTestRecord(root, {
      treeHash: tree.hash,
      finishedAt: "2026-11-19T10:00:00.000Z",
      durationMs: 1000,
      success: true,
      total: 3,
    });

    expect(findReusableResult({ cwd: root, tree })?.total).toBe(3);

    writeFileSync(path.join(root, "src/a.ts"), "export const a = 2;");
    const changed = (await treeHash(root, git))!;

    expect(findReusableResult({ cwd: root, tree: changed })).toBeNull();
  });

  it("never reuses a failed record", async () => {
    const tree = (await treeHash(root, git))!;

    writeTestRecord(root, {
      treeHash: tree.hash,
      finishedAt: "x",
      durationMs: 1,
      success: false,
      total: 1,
    });

    expect(findReusableResult({ cwd: root, tree })).toBeNull();
  });

  it("accepts a passing vitest report newer than the tree, not an older one", async () => {
    const report = path.join(root, "report.json");

    writeFileSync(
      report,
      JSON.stringify({ success: true, numTotalTests: 7, startTime: 1, testResults: [] }),
    );
    const tree = (await treeHash(root, git))!;

    utimesSync(report, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    expect(findReusableResult({ cwd: root, tree, reportPath: report })?.total).toBe(7);
    expect(readTestRecord(root)?.treeHash).toBe(tree.hash);

    rmSync(path.join(root, "node_modules/.cache"), { recursive: true, force: true });
    utimesSync(report, new Date(Date.now() - 600000), new Date(Date.now() - 600000));
    expect(findReusableResult({ cwd: root, tree, reportPath: report })).toBeNull();
  });
});

describe("vitest report reuse", () => {
  const future = () => new Date(Date.now() + 5000);

  function writeReport(names: string[]) {
    const report = path.join(root, "report.json");

    writeFileSync(
      report,
      JSON.stringify({
        success: true,
        numTotalTests: names.length,
        startTime: 1,
        testResults: names.map((name) => ({ name: path.join(root, name) })),
      }),
    );
    utimesSync(report, future(), future());

    return report;
  }

  const specGit: GitRunner = async () => ({
    code: 0,
    stdout: "package.json\0src/a.spec.ts\0src/b.spec.ts\0",
    stderr: "",
  });

  beforeEach(() => {
    writeFileSync(path.join(root, "src/a.spec.ts"), "");
    writeFileSync(path.join(root, "src/b.spec.ts"), "");
  });

  it("is accepted when it lists every spec file", async () => {
    const tree = (await treeHash(root, specGit))!;
    const report = writeReport(["src/a.spec.ts", "src/b.spec.ts"]);

    expect(findReusableResult({ cwd: root, tree, reportPath: report })?.total).toBe(2);
  });

  it("is refused when it is partial", async () => {
    const tree = (await treeHash(root, specGit))!;
    const report = writeReport(["src/a.spec.ts"]);

    expect(findReusableResult({ cwd: root, tree, reportPath: report })).toBeNull();
  });

  it("is refused when a spec it lists was deleted", async () => {
    const report = writeReport(["src/a.spec.ts", "src/b.spec.ts", "src/gone.spec.ts"]);
    const tree = (await treeHash(root, specGit))!;

    expect(findReusableResult({ cwd: root, tree, reportPath: report })).toBeNull();
  });

  it("is refused when a file was deleted after it, even a non-spec file", async () => {
    writeFileSync(path.join(root, "src/c.ts"), "");
    const report = writeReport(["src/a.spec.ts", "src/b.spec.ts"]);

    rmSync(path.join(root, "src/c.ts"));
    // The deletion touches the folder after the report was written.
    utimesSync(path.join(root, "src"), new Date(Date.now() + 60000), new Date(Date.now() + 60000));
    const after = (await treeHash(root, specGit))!;

    expect(findReusableResult({ cwd: root, tree: after, reportPath: report })).toBeNull();
  });

  it("never overrules a recorded failure for the same tree", async () => {
    const tree = (await treeHash(root, specGit))!;
    const report = writeReport(["src/a.spec.ts", "src/b.spec.ts"]);

    writeTestRecord(root, {
      treeHash: tree.hash,
      finishedAt: "x",
      durationMs: 1,
      success: false,
      total: 2,
    });

    expect(findReusableResult({ cwd: root, tree, reportPath: report })).toBeNull();
  });
});

describe("tests step reuse", () => {
  const passing: VitestRun = {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    report: { success: true, numTotalTests: 2, testResults: [] },
    elapsedMs: 4000,
  };

  async function check(extra: { rerunTests?: boolean }, calls: { count: number }) {
    return runCheck({
      cwd: root,
      git,
      skip: ["environment", "typecheck", "lint", "conventions"],
      vitestBinary: "/fake/vitest.mjs",
      vitest: async () => {
        calls.count++;

        return passing;
      },
      ...extra,
    });
  }

  it("runs once, then reuses the recorded result, unless --rerun-tests", async () => {
    const calls = { count: 0 };
    await mkdirSync(path.join(root, "src/x"), { recursive: true });
    writeFileSync(path.join(root, "src/x/x.spec.ts"), "");

    await check({}, calls);
    const second = await check({}, calls);

    expect(calls.count).toBe(1);
    expect(second.steps.find((step) => step.name === "tests")?.detail).toContain("reused");

    await check({ rerunTests: true }, calls);
    expect(calls.count).toBe(2);
  });
});

describe("test timeout", () => {
  it("is ten minutes, or 1.5 times the last run when longer, and the env wins", () => {
    expect(testTimeoutMs({}, 60_000)).toBe(600_000);
    expect(testTimeoutMs({}, 1_403_000)).toBe(2_105_000);
    expect(testTimeoutMs({ WARLOCK_CHECK_TEST_TIMEOUT: "30" }, 1_403_000)).toBe(30_000);
  });

  it("names the elapsed time in the WL8007 message", () => {
    const [problem] = vitestRunFailure({
      code: 143,
      signal: null,
      stdout: "",
      stderr: "",
      report: undefined,
      timedOut: true,
      timeoutMs: 600_000,
      elapsedMs: 600_400,
    });

    expect(problem?.message).toContain("ran 600 s");
  });
});
