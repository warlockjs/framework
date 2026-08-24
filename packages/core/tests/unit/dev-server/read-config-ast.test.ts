import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readConfigAst } from "../../../src/dev-server/read-config-ast";

/*
  The defect: the typings generator obtained a config file's AST by building a
  whole TypeScript Program for it — once per config. A Warlock config imports
  `@warlock.js/core`, which in this monorepo resolves to TypeScript SOURCE, so
  each Program pulled in the entire dependency graph.

  Measured on the reference app's six configs, 2026-08-24:

      ts.createProgram    82,996.00 ms   (2,908 source files per program)
      ts.createSourceFile      5.12 ms
      ratio               16,212x

  And the Program was pure waste: `getTypeChecker()` is never called. Every
  question the generator asks is SYNTACTIC — isImportDeclaration,
  isTypeAliasDeclaration, isVariableDeclaration, isObjectLiteralExpression —
  so resolving 2,908 files to answer them is 2,908 files of discarded work.

  The timing assertion below has a ~1,000x margin against the measured
  post-fix figure, which is what keeps it from being a flaky test while still
  failing loudly if a Program ever creeps back in.
*/

const fixture = path.resolve(__dirname, "../../fixtures/config-ast/sample.config.ts");

describe("readConfigAst — correctness", () => {
  it("returns a parsed source file", async () => {
    const sourceFile = await readConfigAst(fixture);

    expect(sourceFile).toBeDefined();
    expect(sourceFile?.statements.length).toBe(3);
  });

  it("exposes the import declarations the generator walks", async () => {
    const sourceFile = await readConfigAst(fixture);
    const imports = sourceFile!.statements.filter(ts.isImportDeclaration);

    expect(imports).toHaveLength(2);
  });

  it("sets parent pointers, which the visitor relies on", async () => {
    const sourceFile = await readConfigAst(fixture);

    expect(sourceFile!.statements[0]?.parent).toBe(sourceFile);
  });

  it("returns undefined for a file that does not exist", async () => {
    await expect(readConfigAst(path.resolve(__dirname, "nope.ts"))).resolves.toBeUndefined();
  });
});

describe("readConfigAst — it must not build a Program", () => {
  it("parses a config that imports @warlock.js/core in well under a second", async () => {
    const started = performance.now();

    await readConfigAst(fixture);

    const elapsed = performance.now() - started;

    // ~15,000 ms via createProgram; ~1 ms via createSourceFile.
    expect(elapsed).toBeLessThan(1000);
  });

  it("stays fast across repeated calls — six configs is the real workload", async () => {
    const started = performance.now();

    for (let index = 0; index < 6; index++) {
      await readConfigAst(fixture);
    }

    expect(performance.now() - started).toBeLessThan(2000);
  });
});
