import { build } from "esbuild";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The production entry point must not statically reach dev-only tooling.
 *
 * `core/src/index.ts` re-exports the CLI, the dev server, the test helpers and
 * the Vite integration, which puts all of them — and everything they import —
 * into the static module graph of every application that imports the framework.
 *
 * Nothing noticed because the production builder defaults to
 * `packages: "external"`: esbuild never walks into `@warlock.js/core`, so
 * nothing behind it is ever resolved. The cost only becomes visible when
 * something DOES walk the graph. `singleBundle` did, and the build died on
 * `Could not resolve "jiti"` — an optional import of ESLint, reached through
 * `dev-server/health-checker`.
 *
 * That failure was the symptom. This is the property.
 *
 * The check is keyed on OUR directories rather than on a denylist of packages
 * (`eslint`, `vite`, `vitest`, `jiti`, …) for two reasons: a package list rots
 * the moment a dependency changes its own imports, and it can only ever catch
 * names somebody thought of in advance. "The production entry does not reach
 * our dev-only directories" is a statement about our own layout, so it stays
 * true independently of what any dependency does.
 */

const coreRoot = path.resolve(__dirname, "../../..");
const productionEntry = path.join(coreRoot, "src", "index.ts");

/**
 * Directories whose contents exist to serve development, not a running app.
 *
 * `dev-server` and `cli` are the tooling itself; `vite` is a build-time
 * integration; `tests` ships helpers for consumers' test suites and has no
 * business in a production graph.
 */
const DEV_ONLY_DIRECTORIES = ["src/cli", "src/dev-server", "src/tests", "src/vite"] as const;

type GraphInput = {
  /** Path relative to `coreRoot`, in esbuild's forward-slash form. */
  file: string;
  /** Which module pulled it in, when esbuild recorded one. */
  importedBy: string[];
};

/**
 * Every one of our own modules reachable from the production entry.
 *
 * `packages: "external"` is deliberate. Third-party packages are irrelevant
 * here — the question is which of OUR files are in the graph — and leaving them
 * external means the check needs no installed dependency tree and cannot fail
 * for a reason unrelated to what it tests.
 */
async function readProductionGraph(): Promise<GraphInput[]> {
  const result = await build({
    entryPoints: [productionEntry],
    bundle: true,
    write: false,
    metafile: true,
    packages: "external",
    platform: "node",
    format: "esm",
    logLevel: "silent",
    absWorkingDir: coreRoot,
  });

  return Object.entries(result.metafile.inputs).map(([file, input]) => ({
    file,
    importedBy: (input.imports ?? [])
      .filter((imported) => !imported.external)
      .map((imported) => imported.path),
  }));
}

/** Which module in the graph imports `target`, for a message that names a culprit. */
function findImporters(graph: GraphInput[], target: string): string[] {
  return graph.filter((entry) => entry.importedBy.includes(target)).map((entry) => entry.file);
}

describe("the production entry's module graph", () => {
  it("does not statically reach dev-only tooling", async () => {
    const graph = await readProductionGraph();

    const offenders = graph.filter((entry) =>
      DEV_ONLY_DIRECTORIES.some((directory) => entry.file.startsWith(`${directory}/`)),
    );

    // Grouped by directory and reported with an importer, because a bare list
    // of forty file paths says a rule was broken without saying where to cut.
    const report = DEV_ONLY_DIRECTORIES.map((directory) => {
      const inDirectory = offenders.filter((entry) => entry.file.startsWith(`${directory}/`));

      if (inDirectory.length === 0) {
        return undefined;
      }

      const entryPoint = inDirectory[0];
      const importers = findImporters(graph, entryPoint.file);

      return `${directory}: ${inDirectory.length} file(s), e.g. ${entryPoint.file} imported by ${importers.join(", ") || "the entry"}`;
    }).filter((line) => line !== undefined);

    expect(
      report,
      [
        "Dev-only code is reachable from src/index.ts, so it is in every consumer's",
        "production module graph:",
        "",
        ...report.map((line) => `  ${line}`),
        "",
        // Deliberately the ONLY remedy offered. A dynamic `import()` does not help:
        // esbuild resolves it at build time, so a lazily-imported module is still an
        // input of the bundle this check reads — the test would stay red.
        "Move these off the production entry (a subpath export).",
      ].join("\n"),
    ).toEqual([]);
  });
});
