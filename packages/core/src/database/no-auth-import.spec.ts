import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Dependency-direction guard: `@warlock.js/auth` depends on `@warlock.js/core`,
 * so core must never import auth back. A back-edge makes evaluating core's
 * barrel load auth's middleware (and its config reads) as a side effect.
 *
 * Imports are read with the TypeScript pre-processor, so static `import` /
 * `export ... from`, `import type`, dynamic `import()` and `require()` are all
 * caught, while module names that merely appear inside string or template
 * literals (the code-generation stubs) are not.
 */
const FORBIDDEN_MODULE = "@warlock.js/auth";

const sourceRoot = path.resolve(__dirname, "..");

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function importsForbiddenModule(filePath: string): boolean {
  const { importedFiles } = ts.preProcessFile(fs.readFileSync(filePath, "utf8"), true, true);

  return importedFiles.some(
    ({ fileName }) => fileName === FORBIDDEN_MODULE || fileName.startsWith(`${FORBIDDEN_MODULE}/`),
  );
}

describe("core dependency direction", () => {
  it("scans a non-empty source tree", () => {
    expect(listSourceFiles(sourceRoot).length).toBeGreaterThan(100);
  });

  it("does not detect module names that only appear inside template literals", () => {
    const stubText = 'export const stub = `import { authMiddleware } from "@warlock.js/auth";`;';
    const { importedFiles } = ts.preProcessFile(stubText, true, true);

    expect(importedFiles.map(({ fileName }) => fileName)).not.toContain(FORBIDDEN_MODULE);
  });

  it("detects static, type-only, dynamic and require imports", () => {
    const sample = [
      'import { a } from "@warlock.js/auth";',
      'import type { B } from "@warlock.js/auth/types";',
      'const c = await import("@warlock.js/auth");',
      'const d = require("@warlock.js/auth");',
    ].join("\n");

    const found = ts
      .preProcessFile(sample, true, true)
      .importedFiles.filter(({ fileName }) => fileName.startsWith(FORBIDDEN_MODULE));

    expect(found).toHaveLength(4);
  });

  it("never imports @warlock.js/auth anywhere in core/src", () => {
    const offenders = listSourceFiles(sourceRoot)
      .filter(importsForbiddenModule)
      .map((filePath) => path.relative(sourceRoot, filePath).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });
});
