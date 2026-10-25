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
 */
function chainToClientModule(
  from: string,
  specifier: string,
  cwd: string,
  readSource: (file: string) => string | undefined,
): string[] | undefined {
  const first = resolveLocal(specifier, from, cwd);

  if (!first) return undefined;

  const visited = new Set<string>([from]);
  const queue: string[][] = [[from, first]];

  while (queue.length > 0) {
    const chain = queue.shift() ?? [];
    const current = chain.at(-1);

    if (!current || visited.has(current)) continue;

    visited.add(current);

    if (isClientModule(current)) return chain;
    // Another server-only file is reported on its own; a browser file may use `.client`.
    if (isServerOnlyFile(current) || isWebFile(current)) continue;

    const text = readSource(current);

    if (text === undefined) continue;

    for (const { specifier: next } of valueImports(current, text)) {
      const target = resolveLocal(next, current, cwd);

      if (target && !visited.has(target)) queue.push([...chain, target]);
    }
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
): ToolingProblem[] {
  if (!isServerOnlyFile(relativePath)) return [];

  const problems: ToolingProblem[] = [];
  const cache = new Map<string, string | undefined>();
  const readSource = (file: string): string | undefined => {
    if (!cache.has(file)) {
      try {
        cache.set(file, readFileSync(path.join(cwd, file), "utf8"));
      } catch {
        cache.set(file, undefined);
      }
    }

    return cache.get(file);
  };

  for (const { specifier, node } of valueImports(relativePath, sourceFile.text)) {
    const chain = chainToClientModule(relativePath, specifier, cwd, readSource);

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
