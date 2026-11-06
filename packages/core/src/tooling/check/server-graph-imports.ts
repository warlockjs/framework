import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ast from "../syntax/ast";
import { createProblem, type ToolingProblem } from "../problem";
import { resolveLocal, valueImports } from "./client-boundary-conventions";
import { positionOf } from "./source-ast";

/**
 * The advice of the production build's own error for these imports
 * (`@warlock.js/web`, the page-graph check), word for word.
 */
const REMEDY =
  "move the static file into the application's public/ directory and reference " +
  "it by its root URL instead (for example, public/logo.svg becomes /logo.svg). " +
  "The production server build does not compile static-asset imports, ?raw/?url " +
  "queries, or import.meta.url in the page graph in 5.2";

const ASSET_EXTENSIONS = [
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
];

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const SOURCE_FILE = /\.(?:ts|tsx)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "__tests__", "__mocks__"]);

const WORKER_REASON = "uses a `?worker` import query";

/** Why the production server bundle rejects `specifier`, or `undefined` when it accepts it. */
export function serverBundleImportHazard(specifier: string): string | undefined {
  const [base = "", query] = specifier.split("?", 2);
  const lowered = base.toLowerCase();

  if (ASSET_EXTENSIONS.some((extension) => lowered.endsWith(extension))) {
    return "imports a static asset";
  }

  if (query !== undefined && /(^|&)(raw|url)(&|=|$)/.test(query)) {
    return "uses a bundler-specific import query";
  }

  if (query !== undefined && /(^|&)worker(&|=|$)/.test(query)) {
    return WORKER_REASON;
  }

  return undefined;
}

/**
 * What {@link serverGraphImportProblems} shares between the files of one run:
 * the set of project files the server bundle compiles, found once.
 */
export type ServerGraphCache = {
  graph?: Set<string>;
};

export function createServerGraphCache(): ServerGraphCache {
  return {};
}

function webSources(directory: string, cwd: string, into: string[]): void {
  let entries;

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) webSources(full, cwd, into);
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      into.push(path.relative(cwd, full).split(path.sep).join("/"));
    }
  }
}

/**
 * The files the production server bundle compiles: every source file under
 * `src/web` (test files excluded) and every project file they import by value,
 * directly or through other files. A file only the browser build reads is not
 * in it.
 */
function serverGraph(cwd: string, cache: ServerGraphCache): Set<string> {
  if (cache.graph) return cache.graph;

  const roots: string[] = [];

  webSources(path.join(cwd, "src", "web"), cwd, roots);

  const graph = new Set<string>(roots);
  const queue = [...roots];

  for (let head = 0; head < queue.length; head++) {
    const file = queue[head];

    if (file === undefined) continue;

    let text: string;

    try {
      text = readFileSync(path.join(cwd, file), "utf8");
    } catch {
      continue;
    }

    for (const { specifier } of valueImports(file, text)) {
      const target = resolveLocal(specifier, file, cwd);

      if (
        target !== undefined &&
        !graph.has(target) &&
        SOURCE_FILE.test(target) &&
        !TEST_FILE.test(target)
      ) {
        graph.add(target);
        queue.push(target);
      }
    }
  }

  cache.graph = graph;

  return graph;
}

/**
 * `WL9027`: a file the production server bundle compiles imports a static
 * asset or a `?raw` / `?url` / `?worker` query. `warlock dev` accepts these;
 * `warlock build` fails on them. Imports that only browser-loaded files make
 * are not reported.
 */
export function serverGraphImportProblems(
  sourceFile: ast.SourceFile,
  relativePath: string,
  cwd: string,
  cache: ServerGraphCache = createServerGraphCache(),
): ToolingProblem[] {
  if (!SOURCE_FILE.test(relativePath) || TEST_FILE.test(relativePath)) return [];

  const hazards = valueImports(relativePath, sourceFile).flatMap(({ specifier, node }) => {
    const reason = serverBundleImportHazard(specifier);

    return reason === undefined ? [] : [{ specifier, node, reason }];
  });

  if (hazards.length === 0 || !serverGraph(cwd, cache).has(relativePath)) return [];

  return hazards.map(({ specifier, node, reason }) =>
    createProblem({
      code: "WL9027",
      source: "convention",
      severity: "warning",
      message:
        reason === WORKER_REASON
          ? `"${relativePath}" ${reason} (${specifier}). Pages are compiled into the server bundle, which supports plain code imports only; this works in \`warlock dev\` and may fail in the server bundle. If \`warlock build\` fails on it, move the import into code that only the browser loads, or copy the file into the application's public/ directory and reference its root URL.`
          : `"${relativePath}" ${reason} (${specifier}). Pages are compiled into the server bundle, which supports plain code imports only; this works in \`warlock dev\` and \`warlock build\` fails on it. To fix: ${REMEDY}.`,
      file: relativePath,
      ...positionOf(sourceFile, node),
    }),
  );
}
