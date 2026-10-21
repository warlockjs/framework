import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { affectedFiles } from "./affected-files";
import { listChangedFiles, type GitRunner } from "./changed-files";
import { runCheck } from "./run-check";

let root: string;
const write = (file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "check-selection-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("changed selection", () => {
  it("combines HEAD changes with untracked files", async () => {
    write("src/a.ts", "export {};");
    write("src/new.ts", "export {};");
    const git: GitRunner = async (args) => ({
      code: 0,
      stderr: "",
      stdout: args[0] === "diff" ? "src/a.ts\n" : "src/new.ts\n",
    });
    expect(await listChangedFiles({ cwd: root, git })).toEqual({
      files: ["src/a.ts", "src/new.ts"],
    });
  });
  it("includes transitive importers, re-exports, tests and cycles, excluding unrelated files", async () => {
    write("src/a.ts", 'import "./c"; export const a = 1;');
    write("src/b.ts", 'export { a } from "./a";');
    write("src/c.ts", 'import type { a } from "./b";');
    write("tests/a.spec.ts", 'import "../src/c";');
    write("src/other.ts", "export {};");
    expect(await affectedFiles(root, ["src/a.ts"])).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "tests/a.spec.ts",
    ]);
    expect(await affectedFiles(root, [])).toEqual([]);
  });
  it("retains dependents of deleted source files", async () => {
    write("src/importer.ts", 'import "./removed";');
    expect(await affectedFiles(root, ["src/removed.ts"])).toEqual(["src/importer.ts"]);
  });
  it("resolves compiler path aliases transitively", async () => {
    write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "web/*": ["./src/web/*"] } },
        include: ["src"],
      }),
    );
    write("src/web/value.ts", "export const value = 1;");
    write("src/web/page.ts", 'import { value } from "web/value"; export { value };');
    expect(await affectedFiles(root, ["src/web/value.ts"])).toEqual([
      "src/web/page.ts",
      "src/web/value.ts",
    ]);
  });
  it("passes the expanded selection to the pipeline", async () => {
    write("src/a.ts", "export const a = 1;");
    write("src/b.ts", 'import { a } from "./a";');
    const git: GitRunner = async (args) => ({
      code: 0,
      stderr: "",
      stdout: args[0] === "diff" ? "src/a.ts\n" : "",
    });
    const report = await runCheck({
      cwd: root,
      changed: true,
      git,
      skip: ["lint", "tests"],
      typecheck: (options) => {
        expect(options.files).toEqual(["src/a.ts", "src/b.ts"]);
        return {
          ok: true,
          mode: "files",
          files: [...(options.files ?? [])],
          checkedFiles: 2,
          problems: [],
          durationMs: 0,
          buildInfoFile: null,
        };
      },
    });
    expect(report.files).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("safe fixes", () => {
  it("offers a JSON fix and applies it before checks, preserving quotes and unrelated strings", async () => {
    write("src/a.ts", "import './b.js'; const text = './b.js';\n");
    write("src/b.ts", "export {};\n");
    const options = { cwd: root, skip: ["environment", "typecheck", "lint", "tests"] as const };
    const before = await runCheck(options);
    expect(before.problems.find((problem) => problem.code === "WL9002")?.fix).toMatchObject({
      text: "",
    });
    const after = await runCheck({ ...options, fix: true });
    expect(after.problems).toEqual([]);
    expect(readFileSync(path.join(root, "src/a.ts"), "utf8")).toBe(
      "import './b'; const text = './b.js';\n",
    );
    expect((await runCheck({ ...options, fix: true })).problems).toEqual([]);
  });
  it("does not offer unsafe offsets for escaped import literals", async () => {
    write("src/a.ts", String.raw`import './b.\x6as';`);
    const report = await runCheck({
      cwd: root,
      fix: true,
      skip: ["environment", "typecheck", "lint", "tests"],
    });
    expect(report.problems.find((problem) => problem.code === "WL9002")?.fix).toBeUndefined();
    expect(readFileSync(path.join(root, "src/a.ts"), "utf8")).toBe(String.raw`import './b.\x6as';`);
  });
  it("does not fix ignored or disabled rules", async () => {
    write("src/a.ts", "// warlock-check-ignore WL9002\nimport './b.js';\n");
    const options = {
      cwd: root,
      fix: true,
      skip: ["environment", "typecheck", "lint", "tests"] as const,
    };
    await runCheck(options);
    expect(readFileSync(path.join(root, "src/a.ts"), "utf8")).toContain("./b.js");
    write("src/a.ts", "import './b.js';\n");
    write(".warlock-check.json", JSON.stringify({ rules: { WL9002: "off" } }));
    await runCheck(options);
    expect(readFileSync(path.join(root, "src/a.ts"), "utf8")).toContain("./b.js");
  });
  it("leaves structural convention problems for human repair", async () => {
    write("src/web/page.tsx", "const Page = () => <select/>;");
    const report = await runCheck({
      cwd: root,
      fix: true,
      skip: ["environment", "typecheck", "lint", "tests"],
    });
    expect(report.problems.find((problem) => problem.code === "WL9016")?.fix).toBeUndefined();
  });
});
