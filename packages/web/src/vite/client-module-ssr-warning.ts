/**
 * Development warning for a `.client.*` module that touches a browser global
 * while it is being evaluated on the server.
 *
 * `.client.*` is a client-only boundary for server-only code, not a way to skip
 * the server render: a page, layout or component may import a `.client.*`
 * module, and that module is evaluated by the server render unless the caller
 * wraps its use in `<ClientOnly>`. Top-level access to `window`, `document` or
 * similar then throws during SSR. This plugin reads each `.client.*` module the
 * dev server evaluates for SSR and names the first top-level access, so the
 * error is explained before it is hit.
 *
 * Only code that runs when the module is evaluated is judged: function and
 * class-method bodies are skipped, as is anything guarded by a `typeof window`
 * test. The warning is advisory and never changes the module.
 */
import { parse } from "@babel/parser";
import * as t from "@babel/types";
import type { Plugin } from "vite";
import { moduleKey } from "../shared/module-key";
import { isClientFile } from "./gate-a-resolve";

/** Browser globals that do not exist in the server runtime. */
const BROWSER_GLOBALS = new Set([
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "location",
  "history",
  "matchMedia",
]);

const CODE_MODULE = /\.([cm]?[jt]sx?)$/;

export type BrowserGlobalAccess = {
  name: string;
  line: number | null;
};

function isFunctionBoundary(node: t.Node): boolean {
  return (
    t.isFunction(node) ||
    t.isClassMethod(node) ||
    t.isClassPrivateMethod(node) ||
    t.isTSDeclareFunction(node)
  );
}

/** Whether a test expression mentions `typeof <browser global>`. */
function testsForGlobal(test: t.Node): boolean {
  let found = false;
  const visit = (node: t.Node): void => {
    if (found) return;
    if (
      t.isUnaryExpression(node, { operator: "typeof" }) &&
      t.isIdentifier(node.argument) &&
      BROWSER_GLOBALS.has(node.argument.name)
    ) {
      found = true;
      return;
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item) visit(item as t.Node);
      } else if (child) {
        visit(child as t.Node);
      }
    }
  };
  visit(test);
  return found;
}

/**
 * The browser globals a module reads while it is being evaluated, in source
 * order. Reads inside functions, inside `typeof <global>` and inside a branch
 * guarded by a `typeof <global>` test are not reported.
 */
export function topLevelBrowserGlobals(code: string, id: string): BrowserGlobalAccess[] {
  let program: t.File;
  try {
    program = parse(code, {
      sourceType: "module",
      plugins: /\.[cm]?ts$/.test(moduleKey(id)) ? ["typescript"] : ["typescript", "jsx"],
    });
  } catch {
    return [];
  }

  const found: BrowserGlobalAccess[] = [];
  const visit = (node: t.Node, parent: t.Node | undefined): void => {
    if (isFunctionBoundary(node)) return;
    if (t.isTSType(node) || t.isTSTypeAnnotation(node)) return;
    if (t.isUnaryExpression(node, { operator: "typeof" })) return;
    if ((t.isIfStatement(node) || t.isConditionalExpression(node)) && testsForGlobal(node.test)) {
      return;
    }
    if (t.isLogicalExpression(node) && testsForGlobal(node.left)) return;
    if (
      t.isIdentifier(node) &&
      BROWSER_GLOBALS.has(node.name) &&
      !(t.isMemberExpression(parent) && parent.property === node && !parent.computed) &&
      !(t.isObjectProperty(parent) && parent.key === node && !parent.computed) &&
      !t.isImportSpecifier(parent) &&
      !t.isImportDefaultSpecifier(parent)
    ) {
      found.push({ name: node.name, line: node.loc?.start.line ?? null });
      return;
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item) visit(item as t.Node, node);
      } else if (child) {
        visit(child as t.Node, node);
      }
    }
  };
  visit(program.program, undefined);

  return found;
}

/** The warning text for one `.client.*` module, or `undefined` when it is clean. */
export function clientModuleSsrWarning(code: string, id: string): string | undefined {
  const [first] = topLevelBrowserGlobals(code, id);
  if (!first) return undefined;

  const file = moduleKey(id);
  const where = first.line === null ? file : `${file}:${first.line}`;

  return [
    `[warlock:web] a .client module reads \`${first.name}\` while it is evaluated on the server.`,
    ``,
    `Location: ${where}`,
    `Cause: .client.* modules may be imported by pages and components and then render on the server. A \`${first.name}\` access outside a function runs when the module is imported, and the server has no \`${first.name}\`.`,
    `Fix: Move the access into an effect or event handler, guard it with \`typeof ${first.name} !== "undefined"\`, or wrap the component that needs it in <ClientOnly> and load the module with React.lazy.`,
  ].join("\n");
}

/**
 * Dev-server plugin: warns once per `.client.*` module that would throw on
 * import during SSR. Serve-only; the production client build never sees SSR.
 */
export function clientModuleSsrWarningPlugin(): Plugin {
  const warned = new Set<string>();

  return {
    name: "warlock:client-module-ssr-warning",
    apply: "serve",
    transform(code, id, options) {
      if (options?.ssr !== true) return null;
      const file = moduleKey(id);
      if (!CODE_MODULE.test(file) || !isClientFile(file) || warned.has(file)) return null;
      if (file.includes("/node_modules/")) return null;

      warned.add(file);
      const message = clientModuleSsrWarning(code, id);
      if (message) this.warn(message);

      return null;
    },
  };
}
