import { readFileSync } from "node:fs";
import path from "node:path";
import * as ast from "../syntax/ast";
import { calleeName, literalString, unwrap, walk, type SourceFinding } from "./source-ast";

/**
 * Project-wide facts the browser-reference checks need. Gathered once per run
 * (`runConventions`) because a route is registered in one file and referenced
 * from another.
 */
export type ApiRouteFacts = {
  /** Names of routes registered with `clientVisible: false`. */
  readonly clientHiddenNames: ReadonlySet<string>;
  /** Whether any page, layout or root setup file declares `config.apiRoutes`. */
  readonly declaresApiRoutes: boolean;
};

export const EMPTY_API_ROUTE_FACTS: ApiRouteFacts = {
  clientHiddenNames: new Set(),
  declaresApiRoutes: false,
};

/** Browser-side route-taking helpers from `@warlock.js/web`. */
const ROUTE_CALLS = new Set(["apiHref", "useSubmitForm"]);

/** The value of a literal key on an object literal argument, when there is one. */
function objectProperty(object: ast.Node, name: string): ast.Node | undefined {
  const value = unwrap(object);
  if (value.type !== "ObjectExpression") return undefined;
  for (const property of value.properties) {
    if (property.type !== "Property") continue;
    if (ast.keyName(property.key) === name) return property.value;
  }
  return undefined;
}

/**
 * Names of the routes a source file registers with `clientVisible: false`
 * inside an options object that also carries a literal `name`. A group prefix
 * is not applied here, so a route whose name comes only from a group is not
 * recognised; name such a route with a literal `name` option.
 */
export function clientHiddenRouteNamesOf(source: ast.SourceFile): string[] {
  const names: string[] = [];

  walk(
    source,
    (node) => {
      if (node.type !== "CallExpression") return;
      for (const argument of node.arguments) {
        const hidden = objectProperty(argument, "clientVisible");
        const flag = hidden === undefined ? undefined : unwrap(hidden);
        const name = literalString(objectProperty(argument, "name"));
        if (flag?.type === "Literal" && flag.value === false && name !== undefined)
          names.push(name);
      }
    },
    true,
  );

  return names;
}

/** Whether a setup file's exported `config` object declares an `apiRoutes` key. */
export function declaresApiRoutesOf(source: ast.SourceFile): boolean {
  let declared = false;

  walk(
    source,
    (node) => {
      if (declared) return false;
      if (node.type !== "VariableDeclarator" || ast.keyName(node.id) !== "config") return;
      if (node.init === null || node.init === undefined) return;
      if (objectProperty(node.init, "apiRoutes") !== undefined) declared = true;
    },
    true,
  );

  return declared;
}

/**
 * The static name a route-taking call receives: a string literal, a template
 * with no substitutions, or the static prefix of a template. `undefined` means
 * the name is only known at run time.
 */
function staticNameOf(node: ast.Node): { name: string; prefix: boolean } | undefined {
  const value = unwrap(node);
  const literal = literalString(value);
  if (literal !== undefined) return { name: literal, prefix: false };
  if (value.type === "TemplateLiteral" && value.expressions.length > 0) {
    const head = value.quasis[0]?.value.cooked ?? "";
    return head.length > 0 ? { name: head, prefix: true } : undefined;
  }
  return undefined;
}

/** The route-name argument of an `apiHref(name)` or `useSubmitForm({ route })` call. */
function routeArgumentOf(call: ast.CallExpression): ast.Node | undefined {
  const first = call.arguments[0];
  if (first === undefined) return undefined;
  if (calleeName(call) === "apiHref") return first;
  return objectProperty(first, "route");
}

/**
 * The browser route-reference conventions:
 *
 * - `WL9020` (error) a web module passes a name of a `clientVisible: false`
 *   route to `apiHref()` or `useSubmitForm({ route })`, literally or as a
 *   template prefix;
 * - `WL9019` (warning) such a call takes a name that cannot be read statically
 *   and no page declares `config.apiRoutes`, so the page's route table cannot
 *   be computed. The declaration is checked app-wide, not per page.
 *
 * Applies to `src/web/**` modules, outside test files.
 */
export function apiRouteReferenceFindings(
  source: ast.SourceFile,
  facts: ApiRouteFacts = EMPTY_API_ROUTE_FACTS,
): SourceFinding[] {
  if (!/^src\/web\/.*\.[cm]?[jt]sx?$/.test(source.fileName)) return [];
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(source.fileName)) return [];

  const findings: SourceFinding[] = [];

  walk(
    source,
    (node) => {
      if (node.type !== "CallExpression") return;
      if (!ROUTE_CALLS.has(calleeName(node) ?? "")) return;
      const argument = routeArgumentOf(node);
      if (argument === undefined) return;
      const target = staticNameOf(argument);

      if (target === undefined) {
        if (!facts.declaresApiRoutes)
          findings.push({
            code: "WL9019",
            node: argument,
            severity: "warning",
            message:
              "This route name is only known at run time, so the page's browser route table cannot include it. Pass a string literal, or declare the names with config.apiRoutes in the page's setup file.",
          });
        return;
      }

      const hidden = [...facts.clientHiddenNames].find((name) =>
        target.prefix ? name.startsWith(target.name) : name === target.name,
      );

      if (hidden !== undefined)
        findings.push({
          code: "WL9020",
          node: argument,
          severity: "error",
          message: `Route "${hidden}" is registered with clientVisible: false and cannot be referenced from browser code.`,
        });
    },
    true,
  );

  return findings;
}

/**
 * Gathers the project-wide facts from `files` (project-relative). Unreadable or
 * unparsable files contribute nothing, as the per-file checks report them.
 */
export function collectApiRouteFacts(cwd: string, files: readonly string[]): ApiRouteFacts {
  const clientHiddenNames = new Set<string>();
  let declaresApiRoutes = false;

  for (const file of files) {
    if (!/^src\/.*\.[cm]?[jt]sx?$/.test(file)) continue;

    let sourceFile: ast.SourceFile;

    try {
      sourceFile = ast.parseSourceFile(file, readFileSync(path.join(cwd, file), "utf8"));
    } catch {
      continue;
    }

    for (const name of clientHiddenRouteNamesOf(sourceFile)) clientHiddenNames.add(name);
    if (/^src\/web\/.*\.setup\.[cm]?[jt]sx?$/.test(file) && declaresApiRoutesOf(sourceFile))
      declaresApiRoutes = true;
  }

  return { clientHiddenNames, declaresApiRoutes };
}
