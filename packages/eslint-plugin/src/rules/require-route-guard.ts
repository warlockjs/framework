import type { Rule } from "eslint";
import type * as ESTree from "estree";
import {
  ancestors,
  asNode,
  calleeName,
  docsUrl,
  isFunctionNode,
  objectKeyName,
  parentOf,
  propertyName,
  unwrapExpression,
  type AnyNode,
} from "../utils/ast";

const MUTATING_ROUTER_METHODS: ReadonlySet<string> = new Set(["post", "put", "patch", "delete"]);

/** Route builder methods (`router.route(path).create(…)`) that register a mutating route. */
const MUTATING_BUILDER_METHODS: ReadonlySet<string> = new Set([
  "post",
  "postOne",
  "put",
  "updateOne",
  "patch",
  "patchOne",
  "delete",
  "deleteOne",
  "create",
  "update",
  "destroy",
]);

const READ_ONLY_RESOURCE_METHODS: ReadonlySet<string> = new Set(["list", "get", "show"]);

const MUTATING_HTTP_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Middleware whose name contains one of these words counts as an auth guard. */
const GUARD_NAME_PATTERN = /auth|guard/i;

export type RequireRouteGuardOptions = {
  routerNames?: string[];
  /** Functions that wrap routes in an auth-guarded group, e.g. `guarded(() => …)`. */
  guardFunctions?: string[];
  /** Middleware factory names that count as auth guards, besides `*auth*`/`*guard*` names. */
  guardMiddleware?: string[];
};

/**
 * A POST/PUT/PATCH/DELETE route must either run auth middleware (on the route,
 * its route builder or an enclosing group) or say `public: true`. A mutating
 * endpoint without a guard is the easiest security hole to ship by accident.
 */
export const requireRouteGuard: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an auth guard middleware or an explicit `public: true` on mutating routes",
      recommended: true,
      url: docsUrl("require-route-guard"),
    },
    hasSuggestions: true,
    schema: [
      {
        type: "object",
        properties: {
          routerNames: { type: "array", items: { type: "string" } },
          guardFunctions: { type: "array", items: { type: "string" } },
          guardMiddleware: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unguarded:
        "Mutating route `{{method}}` has no auth middleware. Add an auth guard (`middleware: [authMiddleware()]`, or register it inside a guarded group) or mark it intentionally open with `public: true`.",
      markPublic:
        "Mark this route `public: true` (it is meant to be reachable without signing in).",
    },
  },

  create(context) {
    const options = (context.options[0] ?? {}) as RequireRouteGuardOptions;
    const routerNames = new Set(options.routerNames ?? ["router"]);
    const guardFunctions = new Set(options.guardFunctions ?? ["guarded"]);
    const guardMiddleware = new Set(options.guardMiddleware ?? ["authMiddleware"]);

    const isGuardName = (name: string | undefined) =>
      name !== undefined && (guardMiddleware.has(name) || GUARD_NAME_PATTERN.test(name));

    /** `public: true`, a guard in `middleware`, or an options value we cannot see into. */
    const optionsGuard = (node: ESTree.Node | undefined): "guarded" | "unguarded" | "none" => {
      if (!node) return "none";
      const value = unwrapExpression(node);
      if (value.type !== "ObjectExpression") return "guarded";

      let verdict: "guarded" | "unguarded" = "unguarded";
      for (const property of value.properties) {
        if (property.type === "SpreadElement") {
          verdict = "guarded";
          continue;
        }
        const key = objectKeyName(property);
        const propertyValue = unwrapExpression(property.value);
        if (key === "public" && propertyValue.type === "Literal" && propertyValue.value === true) {
          return "guarded";
        }
        if (key === "middleware" && middlewareHasGuard(propertyValue, isGuardName)) {
          return "guarded";
        }
      }

      return verdict;
    };

    /** Whether an enclosing function is a guarded (or public) group callback. */
    const insideGuardedGroup = (node: AnyNode): boolean => {
      for (const ancestor of ancestors(node)) {
        const parent = parentOf(ancestor);
        if (!isFunctionNode(ancestor)) continue;
        if (!parent || parent.type !== "CallExpression") continue;
        if (!(parent.arguments as ESTree.Node[]).includes(ancestor)) continue;

        const name = calleeName(parent);
        if (name !== undefined && guardFunctions.has(name)) return true;

        const callee = unwrapExpression(parent.callee);
        if (
          callee.type === "MemberExpression" &&
          propertyName(callee) === "group" &&
          isRouter(callee.object, routerNames) &&
          optionsGuard(parent.arguments[0]) === "guarded"
        ) {
          return true;
        }
      }
      return false;
    };

    const report = (
      call: ESTree.CallExpression,
      method: string,
      optionsNode: ESTree.Node | undefined,
      optionsIndex: number,
    ) => {
      context.report({
        node: call,
        messageId: "unguarded",
        data: { method },
        suggest: [
          {
            messageId: "markPublic",
            fix: (fixer) => {
              const value = optionsNode ? unwrapExpression(optionsNode) : undefined;
              if (value?.type === "ObjectExpression") {
                const first = value.properties[0];
                return first
                  ? fixer.insertTextBefore(first, "public: true, ")
                  : fixer.replaceText(value, "{ public: true }");
              }
              const previous = call.arguments[optionsIndex - 1];
              return previous ? fixer.insertTextAfter(previous, ", { public: true }") : null;
            },
          },
        ],
      });
    };

    return {
      CallExpression(listenerNode) {
        const call = asNode(listenerNode) as ESTree.CallExpression & AnyNode;
        const callee = unwrapExpression(call.callee);
        if (callee.type !== "MemberExpression") return;
        const method = propertyName(callee);
        if (!method) return;

        // router.post(path, handler, options)
        if (isRouter(callee.object, routerNames)) {
          if (MUTATING_ROUTER_METHODS.has(method)) {
            const optionsNode = call.arguments[2];
            if (optionsGuard(optionsNode) === "guarded" || insideGuardedGroup(call)) return;
            report(call, `${method.toUpperCase()} ${pathText(call.arguments[0])}`, optionsNode, 2);
            return;
          }

          // router.add("POST", path, handler, options)
          if (method === "add") {
            const httpMethod = literalString(call.arguments[0])?.toUpperCase();
            if (!httpMethod || !MUTATING_HTTP_METHODS.has(httpMethod)) return;
            const optionsNode = call.arguments[3];
            if (optionsGuard(optionsNode) === "guarded" || insideGuardedGroup(call)) return;
            report(call, `${httpMethod} ${pathText(call.arguments[1])}`, optionsNode, 3);
            return;
          }

          // router.restfulResource(path, resource, options)
          if (method === "restfulResource") {
            const optionsNode = call.arguments[2];
            if (resourceIsReadOnly(optionsNode)) return;
            if (optionsGuard(optionsNode) === "guarded" || insideGuardedGroup(call)) return;
            report(call, `resource ${pathText(call.arguments[0])}`, optionsNode, 2);
          }
          return;
        }

        // router.route(path, options).create(handler, options)
        if (!MUTATING_BUILDER_METHODS.has(method)) return;
        const chain = builderChain(callee.object, routerNames);
        if (!chain) return;

        const optionsNode = call.arguments[1];
        if (optionsGuard(optionsNode) === "guarded") return;
        if (chain.optionNodes.some((node) => optionsGuard(node) === "guarded")) return;
        if (insideGuardedGroup(call)) return;

        report(call, `${method} ${chain.path}`, optionsNode, 1);
      },
    };
  },
};

function isRouter(node: ESTree.Node, routerNames: ReadonlySet<string>): boolean {
  const target = unwrapExpression(node);
  return target.type === "Identifier" && routerNames.has(target.name);
}

function middlewareHasGuard(
  node: ESTree.Node,
  isGuardName: (name: string | undefined) => boolean,
): boolean {
  if (node.type !== "ArrayExpression") return true; // a variable or call: cannot see into it
  return node.elements.some((element) => {
    if (!element) return false;
    if (element.type === "SpreadElement") return true;
    const value = unwrapExpression(element);
    if (value.type === "Identifier") return isGuardName(value.name);
    if (value.type === "CallExpression") return isGuardName(calleeName(value));
    if (value.type === "MemberExpression") return isGuardName(propertyName(value));
    return false;
  });
}

/**
 * Walk a builder chain back to `router.route(path, options)`, collecting every
 * options object passed along the way (`route()`, `nest()`).
 */
function builderChain(
  node: ESTree.Node,
  routerNames: ReadonlySet<string>,
): { path: string; optionNodes: ESTree.Node[] } | undefined {
  const optionNodes: ESTree.Node[] = [];
  let current = unwrapExpression(node);

  while (current.type === "CallExpression") {
    const callee = unwrapExpression(current.callee);
    if (callee.type !== "MemberExpression") return undefined;
    const name = propertyName(callee);

    if (name === "route" && isRouter(callee.object, routerNames)) {
      const options = current.arguments[1];
      if (options) optionNodes.push(options);
      return { path: pathText(current.arguments[0]), optionNodes };
    }

    if (name === "nest") {
      const options = current.arguments[1];
      if (options) optionNodes.push(options);
    }

    current = unwrapExpression(callee.object);
  }

  return undefined;
}

function resourceIsReadOnly(node: ESTree.Node | undefined): boolean {
  if (!node) return false;
  const value = unwrapExpression(node);
  if (value.type !== "ObjectExpression") return false;

  for (const property of value.properties) {
    if (property.type !== "Property" || objectKeyName(property) !== "only") continue;
    const only = unwrapExpression(property.value);
    if (only.type !== "ArrayExpression") return false;
    return only.elements.every((element) => {
      const method = element ? literalString(element) : undefined;
      return method !== undefined && READ_ONLY_RESOURCE_METHODS.has(method);
    });
  }

  return false;
}

function literalString(node: ESTree.Node | undefined): string | undefined {
  if (!node) return undefined;
  const value = unwrapExpression(node);
  if (value.type === "Literal" && typeof value.value === "string") return value.value;
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

function pathText(node: ESTree.Node | undefined): string {
  return literalString(node) ?? "(dynamic path)";
}
