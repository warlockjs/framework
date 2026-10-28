import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { importSpecifiers } from "../syntax/imports";
import * as ast from "../syntax/ast";
import { createProblem, type ToolingProblem } from "../problem";
import { positionOf } from "./source-ast";

/** Extensions tried when resolving an extension-less import, in Vite's order. */
const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;

const SERVER_ONLY_SUFFIX =
  /\.(?:controller|service|repository|model|connector|server)\.[cm]?[jt]sx?$/;

/** `*.client.ts(x)` or anything under a `.client/` directory. */
export function isClientModule(relativePath: string): boolean {
  return /\.client\.[cm]?[jt]sx?$/.test(relativePath) || /(^|\/)\.client\//.test(relativePath);
}

/**
 * Whether a project-relative file is server-only code: the files that run in
 * the server process and must never reach the browser.
 *
 * - controllers, services, repositories, models, connectors and `*.server.*`
 *   files, by suffix or by folder, anywhere under `src/`;
 * - a module's `routes.ts`, `main.ts`, `worker.ts` and `events/`.
 *
 * A `.client.*` file is never server-only, whatever its name also says.
 */
export function isServerOnlyFile(relativePath: string): boolean {
  if (TEST_FILE.test(relativePath) || isClientModule(relativePath)) return false;
  if (!relativePath.startsWith("src/")) return false;
  if (SERVER_ONLY_SUFFIX.test(relativePath)) return true;
  if (/(^|\/)(?:\.server|server)\//.test(relativePath)) return true;
  if (
    /^src\/app\/(?:[^/]+\/)?(?:controllers|services|repositories|models|connectors|events)\//.test(
      relativePath,
    )
  )
    return true;
  return /^src\/app\/(?:[^/]+\/)?(?:routes|main|worker)\.[cm]?[jt]sx?$/.test(relativePath);
}

/** A project-relative path of a file the browser build owns: pages and everything in `src/web`. */
function isWebFile(relativePath: string): boolean {
  return relativePath.startsWith("src/web/") || /\.page\.[cm]?[jt]sx?$/.test(relativePath);
}

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

/** Resolve a relative or `app/...` / `web/...` specifier to a project-relative source file. */
function resolveLocal(specifier: string, importer: string, cwd: string): string | undefined {
  let base: string;

  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(path.join(cwd, importer)), specifier);
  } else if (specifier.startsWith("app/") || specifier.startsWith("web/")) {
    base = path.join(cwd, "src", specifier);
  } else {
    return undefined;
  }

  const withoutJs = base.replace(/\.jsx?$/, "");
  const candidates = [base, withoutJs]
    .flatMap((stem) => RESOLVE_EXTENSIONS.map((extension) => `${stem}${extension}`))
    .filter((candidate, index, all) => all.indexOf(candidate) === index);
  const found = candidates.find((candidate) => existsSync(candidate) && path.extname(candidate));

  return found ? toPosix(path.relative(cwd, found)) : undefined;
}

/** Whether the import statement is erased by the type system (`import type`, `export type`). */
function isTypeOnly(node: ast.Node): boolean {
  const statement = ast.parentOf(node);

  if (!statement) return false;

  return (
    Reflect.get(statement, "importKind") === "type" ||
    Reflect.get(statement, "exportKind") === "type"
  );
}

/**
 * What {@link clientBoundaryProblems} learns while it walks import chains,
 * shared by every file of one run: the resolved value imports of each file
 * (read, parsed and resolved once) and the files already known to reach no
 * `.client` module. Without it every server-only file would re-read, re-parse
 * and re-resolve the same shared utilities, which scales with files times
 * the size of the import graph.
 */
export type ClientBoundaryCache = {
  /** Resolved project-relative value imports per file; `undefined` when unreadable. */
  readonly imports: Map<string, { specifier: string; target: string | undefined }[] | undefined>;
  /** Resolved targets per `importer\0specifier`. */
  readonly resolved: Map<string, string | undefined>;
  /** Files proven to reach no `.client` module through passable files. */
  readonly dead: Set<string>;
};

export function createClientBoundaryCache(): ClientBoundaryCache {
  return { imports: new Map(), resolved: new Map(), dead: new Set() };
}

function resolveCached(
  specifier: string,
  importer: string,
  cwd: string,
  cache: ClientBoundaryCache,
): string | undefined {
  const key = `${importer}\0${specifier}`;

  if (!cache.resolved.has(key)) cache.resolved.set(key, resolveLocal(specifier, importer, cwd));

  return cache.resolved.get(key);
}

/** The value imports of a project file, resolved, read and parsed once per run. */
function importsOfFile(
  file: string,
  cwd: string,
  cache: ClientBoundaryCache,
): { specifier: string; target: string | undefined }[] | undefined {
  if (cache.imports.has(file)) return cache.imports.get(file);

  let imports: { specifier: string; target: string | undefined }[] | undefined;

  try {
    const text = readFileSync(path.join(cwd, file), "utf8");

    imports = valueImports(file, text).map(({ specifier }) => ({
      specifier,
      target: resolveCached(specifier, file, cwd, cache),
    }));
  } catch {
    imports = undefined;
  }

  cache.imports.set(file, imports);

  return imports;
}

function valueImports(
  relativePath: string,
  source: string,
): { specifier: string; node: ast.Node }[] {
  try {
    return importSpecifiers(relativePath, source).filter(({ node }) => !isTypeOnly(node));
  } catch {
    return [];
  }
}

/**
 * The shortest chain of project-relative files from `from` to a `.client`
 * module, following value imports through files that are neither server-only
 * (judged on their own) nor browser files. `undefined` when none is reached.
 *
 * A search that finds nothing has visited only files that reach nothing, so
 * they are remembered in the cache and never walked again.
 */
function chainToClientModule(
  from: string,
  specifier: string,
  cwd: string,
  cache: ClientBoundaryCache,
): string[] | undefined {
  const first = resolveCached(specifier, from, cwd, cache);

  if (!first) return undefined;

  const visited = new Set<string>([from]);
  // First discoverer of each file, so the chain is rebuilt only when one is found.
  const previous = new Map<string, string>([[first, from]]);
  const queue: string[] = [first];

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];

    if (!current || visited.has(current) || cache.dead.has(current)) continue;

    visited.add(current);

    if (isClientModule(current)) {
      const chain = [current];

      for (let step = previous.get(current); step !== undefined; step = previous.get(step)) {
        chain.unshift(step);
      }

      return chain;
    }
    // Another server-only file is reported on its own; a browser file may use `.client`.
    if (isServerOnlyFile(current) || isWebFile(current)) continue;

    for (const { target } of importsOfFile(current, cwd, cache) ?? []) {
      if (!target || visited.has(target) || cache.dead.has(target) || previous.has(target))
        continue;

      previous.set(target, current);
      queue.push(target);
    }
  }

  for (const file of visited) {
    if (file !== from) cache.dead.add(file);
  }

  return undefined;
}

/**
 * `WL9022`: a server-only file reaches a `.client.*` module, directly or
 * through files that are not server-only themselves.
 *
 * A `.client.*` module is a client-only boundary. Pages, layouts and components
 * may import it; controllers, services, repositories, models, routes,
 * connectors and `*.server.*` files may not. A type-only import is erased and
 * never reported.
 */
export function clientBoundaryProblems(
  sourceFile: ast.SourceFile,
  relativePath: string,
  cwd: string,
  cache: ClientBoundaryCache = createClientBoundaryCache(),
): ToolingProblem[] {
  if (!isServerOnlyFile(relativePath)) return [];

  const problems: ToolingProblem[] = [];

  for (const { specifier, node } of valueImports(relativePath, sourceFile.text)) {
    const chain = chainToClientModule(relativePath, specifier, cwd, cache);

    if (!chain) continue;

    problems.push(
      createProblem({
        code: "WL9022",
        source: "convention",
        message: `Server-only code imports a .client module. Import chain: ${chain.join(" -> ")}.`,
        file: relativePath,
        ...positionOf(sourceFile, node),
      }),
    );
  }

  return problems;
}
