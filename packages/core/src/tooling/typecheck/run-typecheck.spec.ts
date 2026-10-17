import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTypecheck } from "./run-typecheck";

/**
 * `runTypecheck` against a tiny temp project: `math.ts` exports a function,
 * `use.ts` imports it and passes the wrong type, `alone.ts` has its own
 * error and imports nothing.
 */

let root: string;

function write(relative: string, source: string): void {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-typecheck-"));
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        types: [],
      },
      include: ["src"],
    }),
  );
  write("src/math.ts", "export function double(value: number): number {\n  return value * 2;\n}\n");
  write("src/use.ts", 'import { double } from "./math";\n\nexport const result = double("two");\n');
  write("src/alone.ts", "export const flag: boolean = 1;\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runTypecheck", () => {
  it("reports every type error of the program as WL7101 with its TS code and position", () => {
    const result = runTypecheck({ cwd: root });

    expect(result.ok).toBe(false);
    expect(result.mode).toBe("program");
    expect(result.checkedFiles).toBe(3);
    expect(
      result.problems.map((problem) => [problem.file, problem.line, problem.column, problem.rule]),
    ).toEqual(
      expect.arrayContaining([
        ["src/use.ts", 3, 30, "TS2345"],
        ["src/alone.ts", 1, 14, "TS2322"],
      ]),
    );
    expect(result.problems[0]).toMatchObject({
      code: "WL7101",
      category: "code",
      severity: "error",
      source: "typescript",
      skill: "warlock-check",
    });
  });

  it("keeps its incremental state under .warlock/cache", () => {
    const result = runTypecheck({ cwd: root });

    expect(result.buildInfoFile).toBe(
      path.join(root, ".warlock", "cache", "typecheck.tsbuildinfo"),
    );
    expect(existsSync(path.join(root, ".warlock", "cache", "typecheck.tsbuildinfo"))).toBe(true);

    // The second run reads the state back and reports the same problems.
    expect(runTypecheck({ cwd: root }).problems).toHaveLength(result.problems.length);
  });

  it("checks only the given files and the files importing them", () => {
    const result = runTypecheck({ cwd: root, files: ["src/math.ts"] });

    expect(result.mode).toBe("files");
    expect(result.files).toEqual(["src/math.ts", "src/use.ts"]);
    expect(result.problems.map((problem) => problem.file)).toEqual(["src/use.ts"]);
  });

  it("passes a clean project", () => {
    write("src/use.ts", 'import { double } from "./math";\n\nexport const result = double(2);\n');
    write("src/alone.ts", "export const flag: boolean = true;\n");

    expect(runTypecheck({ cwd: root })).toMatchObject({ ok: true, problems: [] });
  });

  it("reports a missing or broken tsconfig as WL7102", () => {
    expect(runTypecheck({ cwd: root, project: "tsconfig.missing.json" }).problems).toEqual([
      expect.objectContaining({ code: "WL7102", file: "tsconfig.missing.json" }),
    ]);

    write("tsconfig.json", '{ "compilerOptions": { "strict": true, }, oops }');

    const broken = runTypecheck({ cwd: root });

    expect(broken.ok).toBe(false);
    expect(broken.problems[0]).toMatchObject({ code: "WL7102", file: "tsconfig.json" });
  });
});
