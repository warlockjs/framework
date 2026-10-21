/**
 * Which named API routes a page's browser code can reach.
 *
 * A page's document embeds only the route names its client code may pass to
 * `apiHref()` or `useSubmitForm({ route })`. This module answers that question
 * from SOURCE, the same way for the production build and for development:
 *
 *   1. Start from the page's client-visible modules: the page UI file, every
 *      layout on its chain, and the application root (and the error page,
 *      when the caller includes it). Each UI file is read through the browser
 *      projection (`projectModule`), so server-only exports and the imports
 *      only they used are gone — exactly what the browser receives. A paired
 *      setup file contributes only its `register()` hook, the one browser-
 *      visible part of a setup sidecar (`projectSetupRegisterModule`).
 *   2. Follow the static imports and dynamic `import()` calls that resolve to
 *      application files (relative paths, and the `web/*` and `app/*`
 *      conventions). Packages from `node_modules` are not walked: their code
 *      never names application routes.
 *   3. Collect every string literal in the walked code, and the static prefix
 *      of every template literal with substitutions (`` `orders.${kind}` `` gives
 *      `orders.`).
 *   4. Add the names a module declares with `config.apiRoutes` (`"orders.show"`
 *      or the prefix pattern `"orders.*"`), read from the setup or UI file that
 *      owns the `config` export.
 *
 * {@link resolveClientApiRouteNames} then keeps the registered route names that
 * one of those rules reaches. The rule is a superset of what the browser
 * calls, and never a guess about what is absent: a name the client code never
 * spells out, and no page declares, is not embedded. The page-level declaration
 * is the escape hatch for a name built at run time.
 *
 * What this cannot see: a route reached only through a path alias the build
 * does not know, or a name assembled from pieces with no static prefix. Both
 * are reported by `warlock check` (`WL9019`) and fixed with `config.apiRoutes`.
 */
import fs from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import { readModuleConfig } from "./read-module-config";
import { projectModule, projectSetupRegisterModule } from "../vite/projection";
import type { AppConventionAlias } from "../vite/app-convention-aliases";

/** A client-visible UI module and its optional setup companion (absolute paths). */
export type ClientApiRouteModule = {
  readonly file: string;
  readonly setupFile?: string;
};

export type ClientApiRouteSources = {
  /** The root, every layout on the page's chain, and the page (plus the error page when rendered). */
  readonly modules: readonly ClientApiRouteModule[];
  /** Import aliases the application resolves (see `appConventionAliases`). */
  readonly aliases: readonly AppConventionAlias[];
};

/**
 * What the walk found. `files` lists every file that was read, so development
 * can tell when the analysis is stale without re-walking the graph.
 */
export type ClientApiRouteAnalysis = {
  /** Every string literal in the walked browser code. */
  readonly literals: ReadonlySet<string>;
  /** Static prefixes of template literals with substitutions. */
  readonly prefixes: ReadonlySet<string>;
  /**
   * `config.apiRoutes` declarations of every walked owner, deduplicated, in
   * discovery order. Entries were validated by `readModuleConfig`.
   */
  readonly declared: readonly string[];
  /** Absolute paths of every file the walk read. */
  readonly files: readonly string[];
};

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".mts"] as const;
const INDEX_FILES = ["index.tsx", "index.ts", "index.jsx", "index.js"] as const;

type Node = Record<string, unknown> & { type: string };

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

/** Every AST node beneath `value`, depth-first. oxc nodes carry no parent links, so this is a plain walk. */
function forEachNode(value: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) forEachNode(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (isNode(value)) visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "parent") forEachNode(child, visit);
  }
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The application file an import specifier names, or `undefined` for a package or an unknown alias. */
export function resolveApplicationImport(
  specifier: string,
  importer: string,
  aliases: readonly AppConventionAlias[],
): string | undefined {
  let base: string;

  if (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  ) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    const alias = aliases.find((entry) => entry.find.test(specifier));
    if (alias === undefined) return undefined;
    base = path.join(alias.replacement, specifier.replace(alias.find, ""));
  }

  const withoutJs = base.replace(/\.(?:m?jsx?)$/, "");
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${withoutJs}${extension}`),
    ...INDEX_FILES.map((index) => path.join(base, index)),
  ];

  return candidates.find((candidate) => isFile(candidate));
}

/** Specifiers of the runtime imports, re-exports and dynamic imports in a parsed module. */
function runtimeSpecifiers(program: unknown): string[] {
  const specifiers: string[] = [];

  forEachNode(program, (node) => {
    if (node.type === "ImportDeclaration" && node.importKind !== "type") {
      specifiers.push(literalValueOf(node.source));
    } else if (
      (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
      node.exportKind !== "type" &&
      isNode(node.source)
    ) {
      specifiers.push(literalValueOf(node.source));
    } else if (node.type === "ImportExpression" && isNode(node.source)) {
      specifiers.push(literalValueOf(node.source));
    }
  });

  return specifiers.filter((specifier) => specifier.length > 0);
}

function literalValueOf(node: unknown): string {
  return isNode(node) && typeof node.value === "string" ? node.value : "";
}

/** Literal names and template prefixes in one parsed module. */
function scanModule(program: unknown): { literals: string[]; prefixes: string[] } {
  const literals: string[] = [];
  const prefixes: string[] = [];

  forEachNode(program, (node) => {
    if (node.type === "Literal" && typeof node.value === "string") {
      literals.push(node.value);
    } else if (node.type === "TemplateLiteral" && Array.isArray(node.quasis)) {
      const quasis = node.quasis as { value?: { cooked?: string | null } }[];
      const head = quasis[0]?.value?.cooked ?? "";
      if (!Array.isArray(node.expressions) || node.expressions.length === 0) {
        if (head.length > 0) literals.push(head);
      } else if (head.length > 0) {
        prefixes.push(head);
      }
    }
  });

  return { literals, prefixes };
}

function ownerKindOf(file: string): "page" | "layout" | "root" {
  const base = path.basename(file);
  if (base === "root.tsx" || base === "root.ts") return "root";
  if (base === "layout.tsx" || base === "layout.ts") return "layout";
  return "page";
}

/** One file the walk visits: a UI module (projected), a setup file (register hook only), or a plain module. */
type WalkEntry = { readonly file: string; readonly role: "ui" | "setup" | "module" };

/**
 * Walks the client-visible graph of one page and returns what it can reach.
 *
 * `read` is injectable for tests; production and development read the disk.
 */
export function analyzeClientApiRoutes(
  sources: ClientApiRouteSources,
  read: (file: string) => string = (file) => fs.readFileSync(file, "utf8"),
): ClientApiRouteAnalysis {
  const literals = new Set<string>();
  const prefixes = new Set<string>();
  const declared: string[] = [];
  const files: string[] = [];
  const visited = new Set<string>();
  const queue: WalkEntry[] = [];

  // Every read goes through here, so the list of files is exactly what the walk
  // depended on: development compares their timestamps to know when to re-walk.
  const readSource = (file: string): string => {
    if (!files.includes(file)) files.push(file);
    return read(file);
  };

  const declare = (declaringFile: string, kind: ReturnType<typeof ownerKindOf>): void => {
    const config = readModuleConfig(declaringFile, readSource(declaringFile), kind, {
      allowMissingDefault: true,
    });
    for (const pattern of config.apiRoutes ?? []) {
      if (!declared.includes(pattern)) declared.push(pattern);
    }
  };

  for (const module of sources.modules) {
    queue.push({ file: module.file, role: "ui" });
    if (module.setupFile !== undefined) queue.push({ file: module.setupFile, role: "setup" });
    const kind = ownerKindOf(module.file);
    declare(module.file, kind);
    if (module.setupFile !== undefined) declare(module.setupFile, kind);
  }

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (visited.has(next.file)) continue;
    visited.add(next.file);

    const program = parseSync(next.file, browserSourceOf(next, readSource(next.file)), {
      sourceType: "module",
    }).program;
    const scanned = scanModule(program);
    for (const literal of scanned.literals) literals.add(literal);
    for (const prefix of scanned.prefixes) prefixes.add(prefix);

    for (const specifier of runtimeSpecifiers(program)) {
      const target = resolveApplicationImport(specifier, next.file, sources.aliases);
      if (target !== undefined && !visited.has(target))
        queue.push({ file: target, role: "module" });
    }
  }

  return { literals, prefixes, declared, files };
}

/** The text of one walked file as the browser receives it. */
function browserSourceOf(entry: WalkEntry, source: string): string {
  if (entry.role === "ui") return projectModule(source, entry.file).code;
  if (entry.role === "setup") return projectSetupRegisterModule(source, entry.file).code;
  return source;
}

/**
 * The registered route names one page can reach, sorted.
 *
 * `clientRouteNames` must already exclude `clientVisible: false` routes; the
 * caller owns that rule because it owns the route snapshot.
 */
export function resolveClientApiRouteNames(
  analysis: ClientApiRouteAnalysis,
  clientRouteNames: Iterable<string>,
): string[] {
  const reached: string[] = [];

  for (const name of clientRouteNames) {
    const byLiteral = analysis.literals.has(name);
    const byPrefix = [...analysis.prefixes].some((prefix) => name.startsWith(prefix));
    const byDeclaration = analysis.declared.some((pattern) =>
      pattern.endsWith(".*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
    );

    if (byLiteral || byPrefix || byDeclaration) reached.push(name);
  }

  return [...new Set(reached)].sort();
}

/** Size and modification time of one file, the cheapest change signal the disk gives. */
function stampOf(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

/**
 * The development answer: a per-request function that re-walks the page only
 * when a file the last walk read has changed. An edit to any imported module
 * shows up on the next request, with no file watcher to keep in step.
 *
 * `clientRouteNames` is read on every call, so routes registered by a route
 * reload are seen without re-walking the sources.
 */
export function createClientApiRouteResolver(
  sources: ClientApiRouteSources,
  clientRouteNames: () => readonly string[],
): () => readonly string[] {
  let walked: { analysis: ClientApiRouteAnalysis; stamps: ReadonlyMap<string, string> } | undefined;

  const isCurrent = (state: NonNullable<typeof walked>): boolean =>
    [...state.stamps].every(([file, stamp]) => stampOf(file) === stamp);

  return () => {
    if (walked === undefined || !isCurrent(walked)) {
      const analysis = analyzeClientApiRoutes(sources);
      walked = {
        analysis,
        stamps: new Map(analysis.files.map((file) => [file, stampOf(file)])),
      };
    }

    return resolveClientApiRouteNames(walked.analysis, clientRouteNames());
  };
}
