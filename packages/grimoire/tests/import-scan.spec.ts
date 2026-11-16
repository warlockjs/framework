/**
 * The root entry (and the Vitest reporter entry) must stay framework-neutral:
 * no file they reach may import `@warlock.js/core` or `@warlock.js/web`, at
 * runtime or as a type. Warlock-specific code lives in `src/warlock` and
 * `src/devtools`, which neither entry may reach.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN = /^@warlock\.js\/(?:core|web)(?:\/|$)/;
const SPECIFIER =
  /(?:^|[\s;}])(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every specifier a module's source imports or re-exports. */
function specifiersOf(text: string): string[] {
  const found: string[] = [];

  for (const match of stripComments(text).matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];

    if (specifier) found.push(specifier);
  }

  return found;
}

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);

  return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), base].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

/** Walk the relative imports from an entry; return reached files and bare specifiers per file. */
function reach(entry: string): { files: string[]; bare: { file: string; specifier: string }[] } {
  const seen = new Set<string>();
  const bare: { file: string; specifier: string }[] = [];
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop();

    if (file === undefined || seen.has(file)) continue;

    seen.add(file);

    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        const target = resolveRelative(file, specifier);

        if (target) pending.push(target);
      } else {
        bare.push({ file: path.relative(packageRoot, file).split(path.sep).join("/"), specifier });
      }
    }
  }

  return {
    files: [...seen].map((file) => path.relative(packageRoot, file).split(path.sep).join("/")).sort(),
    bare,
  };
}

describe("framework-neutral entries", () => {
  it("reads import, export, type-only and dynamic specifiers", () => {
    expect(
      specifiersOf(
        [
          'import { a } from "./a";',
          'import type { B } from "@warlock.js/core";',
          'export * from "./c";',
          'export { d } from "@warlock.js/web/build";',
          'const e = await import("@warlock.js/core/tooling");',
          '// import { f } from "@warlock.js/core";',
        ].join("\n"),
      ),
    ).toEqual(["./a", "@warlock.js/core", "./c", "@warlock.js/web/build", "@warlock.js/core/tooling"]);
  });

  for (const entry of ["src/index.ts", "src/vitest/index.ts"]) {
    it(`${entry} reaches no @warlock.js/core or @warlock.js/web import`, () => {
      const { files, bare } = reach(path.join(packageRoot, entry));

      expect(files.length).toBeGreaterThan(0);
      expect(bare.filter((item) => FORBIDDEN.test(item.specifier))).toEqual([]);
      expect(files.filter((file) => /^src\/(?:warlock|devtools)\//.test(file))).toEqual([]);
    });
  }
});
