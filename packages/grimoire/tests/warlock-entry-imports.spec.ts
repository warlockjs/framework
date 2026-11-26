/**
 * `@warlock.js/grimoire/warlock` is imported by `warlock.config.ts`, which the
 * production entry reaches. Its static runtime imports must stay light: the
 * root of `@warlock.js/core` and node builtins only, and none of the modules
 * that build the book. `@warlock.js/core/tooling` (the TypeScript compiler)
 * and the heavy modules are loaded with `import()` inside actions.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Static `import … from` / `export … from` that are not type-only. Dynamic `import()` is left out on purpose. */
const STATIC = /^\s*(?:import|export)\s+(?!type\s)(?:[\w*${}\s,]+?\s+from\s+)?["']([^"']+)["']/gm;

function runtimeSpecifiers(file: string): string[] {
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  return [...text.matchAll(STATIC)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function resolve(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);

  return [`${base}.ts`, path.join(base, "index.ts")].find(
    (file) => existsSync(file) && statSync(file).isFile(),
  );
}

function reach(entry: string): { files: string[]; packages: string[] } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop();

    if (file === undefined || seen.has(file)) continue;

    seen.add(file);

    for (const specifier of runtimeSpecifiers(file)) {
      if (specifier.startsWith(".")) {
        const target = resolve(file, specifier);

        if (target) pending.push(target);
      } else {
        packages.add(specifier);
      }
    }
  }

  return {
    files: [...seen]
      .map((file) => path.relative(packageRoot, file).split(path.sep).join("/"))
      .sort(),
    packages: [...packages].sort(),
  };
}

describe("the ./warlock entry", () => {
  it("imports only the root of @warlock.js/core and node builtins at load time", () => {
    const { files, packages } = reach(path.join(packageRoot, "src/warlock/index.ts"));

    expect(packages.filter((name) => !name.startsWith("node:"))).toEqual(["@warlock.js/core"]);
    expect(files).toEqual([
      "src/codes/codes.ts",
      "src/codes/index.ts",
      "src/paths/index.ts",
      "src/scry/error.ts",
      "src/warlock/adapter.ts",
      "src/warlock/collect-off-thread.ts",
      "src/warlock/commands.ts",
      "src/warlock/index.ts",
      "src/warlock/languages.ts",
      "src/warlock/logo.ts",
      "src/warlock/mcp-tools.ts",
      "src/warlock/mobile-facts.ts",
      "src/warlock/shows.ts",
    ]);
  });
});
