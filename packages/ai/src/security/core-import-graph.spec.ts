import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Proves that loading `@warlock.js/ai` (the agent path included) never
 * reaches Core's root barrel, which pulls in the HTTP server, the database,
 * cache and mail modules. A standalone agent process must only load the
 * side-effect-free `@warlock.js/core/net` subpath.
 *
 * The graph is resolved statically: each module is transpiled the way the
 * published build compiles it (type-only and unused imports vanish), then
 * every `import` / `export … from` / `import()` specifier is collected.
 * Relative specifiers are followed inside this package, and `@warlock.js/core`
 * specifiers are followed into Core's workspace sources, so a subpath that
 * itself re-exported the root would be caught too.
 */

const aiRoot = path.resolve(__dirname, "..", "..");
const coreRoot = path.resolve(aiRoot, "..", "core");
const coreRootEntry = path.join(coreRoot, "src", "index.ts");

type Edge = { from: string; specifier: string; dynamic: boolean };

/** The specifiers a module imports at runtime, after type-only imports are erased. */
function runtimeSpecifiers(file: string): { specifier: string; dynamic: boolean }[] {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  const source = ts.createSourceFile(file, output, ts.ScriptTarget.ES2022, true);
  const found: { specifier: string; dynamic: boolean }[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({ specifier: node.moduleSpecifier.text, dynamic: false });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;

      if (argument && ts.isStringLiteral(argument)) {
        found.push({ specifier: argument.text, dynamic: true });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

/** Resolve a relative specifier the way the workspace's bundler does. */
function resolveRelative(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);

  return [`${base}.ts`, path.join(base, "index.ts")].find((candidate) => existsSync(candidate));
}

/**
 * Resolve a `@warlock.js/core[/sub]` specifier to its workspace source: the
 * root goes to `src/index.ts`, a subpath to the published entry pkgist builds
 * (`src/<sub>/index.ts`).
 */
function resolveCore(specifier: string): string | undefined {
  if (specifier === "@warlock.js/core") {
    return coreRootEntry;
  }

  const subpath = specifier.slice("@warlock.js/core/".length);
  const entry = path.join(coreRoot, "src", subpath, "index.ts");

  return existsSync(entry) ? entry : undefined;
}

/** Walk every module reachable from `entry`; `followDynamic` also walks `import()` edges. */
function collectGraph(entry: string, followDynamic: boolean) {
  const visited = new Set<string>();
  const edges: Edge[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;

    if (visited.has(file)) continue;

    visited.add(file);

    for (const { specifier, dynamic } of runtimeSpecifiers(file)) {
      edges.push({ from: file, specifier, dynamic });

      if (dynamic && !followDynamic) continue;

      const target = specifier.startsWith(".")
        ? resolveRelative(file, specifier)
        : specifier === "@warlock.js/core" || specifier.startsWith("@warlock.js/core/")
          ? resolveCore(specifier)
          : undefined;

      if (target) {
        queue.push(target);
      }
    }
  }

  return { visited, edges };
}

const relative = (file: string) => path.relative(aiRoot, file);

describe("@warlock.js/ai → @warlock.js/core import graph", () => {
  it("never statically reaches Core's root barrel from the package entry", () => {
    const { visited, edges } = collectGraph(path.join(aiRoot, "src", "index.ts"), false);
    const rootImports = edges
      .filter((edge) => edge.specifier === "@warlock.js/core")
      .map((edge) => relative(edge.from));

    expect(rootImports).toEqual([]);
    expect(visited.has(coreRootEntry)).toBe(false);
  });

  it("never reaches Core's root barrel through a lazy import either", () => {
    const { visited } = collectGraph(path.join(aiRoot, "src", "index.ts"), true);

    expect(visited.has(coreRootEntry)).toBe(false);
  });

  it("loads only the network subpath from Core on the agent path", () => {
    const { edges } = collectGraph(path.join(aiRoot, "src", "agent", "index.ts"), false);
    const coreSpecifiers = new Set(
      edges
        .map((edge) => edge.specifier)
        .filter(
          (specifier) =>
            specifier === "@warlock.js/core" || specifier.startsWith("@warlock.js/core/"),
        ),
    );

    expect([...coreSpecifiers]).toEqual(["@warlock.js/core/net"]);
  });

  it("keeps cache and cascade out of ai's eager graph (they load lazily, as optional peers)", () => {
    const { edges } = collectGraph(path.join(aiRoot, "src", "index.ts"), false);
    const eager = edges
      .filter(
        (edge) =>
          !edge.dynamic &&
          edge.from.startsWith(aiRoot + path.sep) &&
          (edge.specifier === "@warlock.js/cache" || edge.specifier === "@warlock.js/cascade"),
      )
      .map((edge) => `${relative(edge.from)} -> ${edge.specifier}`);

    expect(eager).toEqual([]);
  });
});
