import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ast from "../syntax/ast";
import { connectorsManager } from "../../connectors/connectors-manager";
import type { InspectPage, InspectWarning } from "./inspect-report.types";

/** The fields of `@warlock.js/web`'s installed page record that inspect reads. */
type InstalledPageLike = {
  path: string;
  name?: unknown;
  file: string;
  actions?: unknown;
  guard?: unknown;
};

function isInstalledPage(value: unknown): value is InstalledPageLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "path") === "string" &&
    typeof Reflect.get(value, "file") === "string"
  );
}

/**
 * The pages the `web` connector installed, read through its public
 * `getInstalledPages()` without importing `@warlock.js/web`. `undefined` when
 * no such connector is registered (an API-only app).
 */
export function installedPagesFromConnectors(): unknown[] | undefined {
  const web = connectorsManager.list().find((connector) => connector.name === "web");
  const read = web ? Reflect.get(web, "getInstalledPages") : undefined;

  if (typeof read !== "function") return undefined;

  const pages: unknown = read.call(web);

  return Array.isArray(pages) ? pages : undefined;
}

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

function relativeTo(cwd: string, file: string): string {
  return toPosix(path.isAbsolute(file) ? path.relative(cwd, file) : file);
}

/**
 * The page's layout chain, outermost first: every `layout.tsx` from the web
 * root (the nearest ancestor holding `root.tsx`, else `src/`) down to the
 * page's own directory — the rule `@warlock.js/web` applies.
 */
export function layoutChainOf(pageFile: string, cwd: string): string[] {
  const srcRoot = path.join(cwd, "src");
  const directories: string[] = [];
  let current = path.dirname(pageFile);

  while (current.startsWith(srcRoot)) {
    directories.unshift(current);

    if (existsSync(path.join(current, "root.tsx")) || current === srcRoot) break;

    const parent = path.dirname(current);

    if (parent === current) break;

    current = parent;
  }

  return directories
    .map((directory) => path.join(directory, "layout.tsx"))
    .filter((candidate) => existsSync(candidate));
}

/**
 * Whether a module's source exports a binding named `name`, read with the
 * OXC parser (the page files are TSX that Node cannot import directly).
 */
export function exportsName(file: string, name: string): boolean {
  let source: string;

  try {
    source = readFileSync(file, "utf8");
  } catch {
    return false;
  }

  const sourceFile = ast.parseSourceFile(file, source);

  for (const statement of ast.topLevelDeclarations(sourceFile)) {
    const exported = ast.hasModifier(statement, "export");

    if (exported && ast.isVariableStatement(statement)) {
      if (
        statement.declarations.some(
          (declaration) =>
            ast.isIdentifier(ast.nameNode(declaration)) && ast.valueText(declaration.id) === name,
        )
      ) {
        return true;
      }
    }

    if (
      exported &&
      ast.isFunctionDeclaration(statement) &&
      ast.declarationName(statement) === name
    ) {
      return true;
    }

    if (
      ast.isExportDeclaration(statement) &&
      statement.specifiers.some((element) => ast.valueText(element.exported) === name)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Describe the installed pages: route path and name, page file, layout chain,
 * the files on that chain exporting a `loader`, actions and guard.
 *
 * @param pages The connector's installed page records; see {@link installedPagesFromConnectors}.
 */
export function collectPages(
  pages: readonly unknown[] | undefined,
  cwd: string,
  warnings: InspectWarning[],
): InspectPage[] {
  if (!pages) return [];

  const collected: InspectPage[] = [];

  for (const page of pages) {
    if (!isInstalledPage(page)) {
      warnings.push({ code: null, message: "A page record has no path or file.", source: "pages" });
      continue;
    }

    const pageFile = path.isAbsolute(page.file) ? page.file : path.join(cwd, page.file);
    const layouts = layoutChainOf(pageFile, cwd);
    const loaders = [...layouts, pageFile].filter((file) => exportsName(file, "loader"));
    const actions = Array.isArray(page.actions)
      ? page.actions.filter((action): action is string => typeof action === "string")
      : [];

    collected.push({
      path: page.path,
      name: typeof page.name === "string" && page.name.length > 0 ? page.name : null,
      file: relativeTo(cwd, pageFile),
      layouts: layouts.map((file) => relativeTo(cwd, file)),
      loaders: loaders.map((file) => relativeTo(cwd, file)),
      actions: [...actions].sort(),
      guard: typeof page.guard === "string" ? page.guard : null,
    });
  }

  return collected.sort((first, second) => {
    if (first.path !== second.path) return first.path < second.path ? -1 : 1;

    return first.file.localeCompare(second.file);
  });
}
