/**
 * Parse one config file into an AST.
 *
 * ## Why this is not `ts.createProgram`
 *
 * It was. The typings generator built a whole TypeScript **Program** for each
 * config file just to call `program.getSourceFile(path)` on it. A Warlock
 * config imports `@warlock.js/core`, which in this monorepo resolves to
 * TypeScript **source**, so every one of those Programs resolved and parsed the
 * entire dependency graph behind it.
 *
 * Measured on the reference app's six configs, 2026-08-24:
 *
 * ```
 * ts.createProgram      82,996.00 ms    2,908 source files per program
 * ts.createSourceFile        5.12 ms
 * ratio                 16,212x
 * ```
 *
 * And all of it was discarded. `getTypeChecker()` is never called anywhere in
 * the generator — every question it asks of the AST is syntactic
 * (`isImportDeclaration`, `isTypeAliasDeclaration`, `isVariableDeclaration`,
 * `isObjectLiteralExpression`). Resolving 2,908 files to answer a syntactic
 * question is 2,908 files of work thrown away.
 *
 * A previous pass had already noticed the cost and halved it, from two Programs
 * per file to one — an optimisation inside a premise that did not need to hold.
 *
 * **If a future change here needs a type checker, it needs a Program too, and
 * the cost comes back.** That is the one reason to reconsider this file.
 */

import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function readConfigAst(filePath: string): Promise<ts.SourceFile | undefined> {
  let contents: string;

  try {
    contents = await readFile(filePath, "utf-8");
  } catch {
    // Callers already treat a missing config as "nothing to generate"; a throw
    // here would turn an absent optional file into a failed generation.
    return undefined;
  }

  return ts.createSourceFile(
    filePath,
    contents,
    ts.ScriptTarget.ESNext,
    // The generator's visitors read `node.parent`, which the Program-backed
    // source files provided for free.
    /* setParentNodes */ true,
  );
}
