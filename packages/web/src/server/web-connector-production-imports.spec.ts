import path from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * WR-027: a production start of a built app constructs the web connector, and
 * every STATIC import it reaches is loaded before the first request. Vite (and
 * Rollup behind it, whose loader alone cost ~0.55 s of a measured cold start)
 * is development and build tooling, so it may only be reached through
 * `await import(...)` on a development path. The same holds for the source
 * parser behind page discovery (`@babel/parser`, via `../build/*`) and any
 * other compiler or CSS toolchain: a built app reads its page manifest instead.
 */
const BUILD_TOOLING =
  /^(?:(?:vite|rollup|esbuild|typescript|postcss|tailwindcss|lightningcss|sass)(?:\/|$)|@(?:vitejs|rollup|babel|tailwindcss)\/)/;

async function staticExternalImports(entry: string): Promise<Set<string>> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    logLevel: "silent",
    outdir: "unused",
  });
  const inputs = result.metafile.inputs;
  const start = Object.keys(inputs).find((input) => path.resolve(input) === entry);
  const seen = new Set<string>();
  const externals = new Set<string>();
  const pending = start === undefined ? [] : [start];

  while (pending.length > 0) {
    const file = pending.pop()!;

    if (seen.has(file)) continue;
    seen.add(file);

    for (const imported of inputs[file]?.imports ?? []) {
      if (imported.kind !== "import-statement") continue;

      if (imported.external) externals.add(imported.path);
      else pending.push(imported.path);
    }
  }

  expect(seen.size).toBeGreaterThan(1);

  return externals;
}

describe("web connector production import graph", () => {
  it.each(["web-connector.ts", "web-connector-factory.ts", "../connector/index.ts"])(
    "%s reaches no build tooling (Vite, Rollup, Babel, compilers, CSS) statically",
    async (file) => {
      const externals = await staticExternalImports(path.resolve(__dirname, file));
      const tooling = [...externals].filter((specifier) => BUILD_TOOLING.test(specifier));

      expect(tooling).toEqual([]);
    },
    30_000,
  );
});
