import type { Rule } from "eslint";
import type * as ESTree from "estree";
import {
  asNode,
  docsUrl,
  parentOf,
  propertyName,
  unwrapExpression,
  type AnyNode,
} from "../utils/ast";
import { requestNames, type RequestNameOptions } from "../utils/request-input";

/** Request methods that return every input the client sent, validated or not. */
const UNFILTERED_METHODS: ReadonlySet<string> = new Set([
  "all",
  "allExceptParams",
  "heavy",
  "heavyExceptParams",
]);

/**
 * `request.all()` returns everything the client sent. Handing it to a model
 * query, a service or `inApp()` lets a client set fields the endpoint never
 * meant to accept (mass assignment). `request.validated()` returns only what
 * the route's validation schema accepted.
 */
export const noRequestAll: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow passing `request.all()` to queries, services and `inApp()`; use `request.validated()`",
      recommended: true,
      url: docsUrl("no-request-all"),
    },
    hasSuggestions: true,
    schema: [
      {
        type: "object",
        properties: {
          requestNames: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      passed:
        "`{{request}}.{{method}}()` passes every client-sent field to `{{callee}}`. Use `{{request}}.validated()` so only the fields the validation schema accepted reach it.",
      useValidated: "Replace with `{{request}}.validated()`.",
    },
  },

  create(context) {
    const names = requestNames(context.options[0] as RequestNameOptions | undefined);

    return {
      CallExpression(listenerNode) {
        const node = asNode(listenerNode) as ESTree.CallExpression & AnyNode;
        const callee = unwrapExpression(node.callee);
        if (callee.type !== "MemberExpression") return;

        const object = unwrapExpression(callee.object);
        if (object.type !== "Identifier" || !names.has(object.name)) return;

        const method = propertyName(callee);
        if (!method || !UNFILTERED_METHODS.has(method)) return;

        const target = receivingCall(context, node);
        if (!target) return;

        const property = callee.property;
        context.report({
          node,
          messageId: "passed",
          data: { request: object.name, method, callee: target },
          suggest: [
            {
              messageId: "useValidated",
              data: { request: object.name },
              fix: (fixer) => fixer.replaceText(property, "validated"),
            },
          ],
        });
      },
    };
  },
};

/**
 * The name of the call that ends up receiving this value: directly as an
 * argument, spread into an object/array argument, or through a local
 * constant that is later passed to a call.
 */
function receivingCall(context: Rule.RuleContext, node: AnyNode): string | undefined {
  const direct = callReceiving(node);
  if (direct) return direct;

  // `const data = request.all(); Model.create(data);`
  const parent = parentOf(node);
  if (
    parent?.type === "VariableDeclarator" &&
    parent.init === node &&
    parent.id.type === "Identifier"
  ) {
    for (const variable of context.sourceCode.getDeclaredVariables(parent)) {
      for (const reference of variable.references) {
        if (reference.init) continue;
        const name = callReceiving(reference.identifier as AnyNode);
        if (name) return name;
      }
    }
  }

  return undefined;
}

/** When `node` flows into a call's arguments, the callee's display name. */
function callReceiving(node: AnyNode): string | undefined {
  let current: AnyNode = node;

  for (;;) {
    const parent = parentOf(current);
    if (!parent) return undefined;

    if (parent.type === "CallExpression" || parent.type === "NewExpression") {
      if (!(parent.arguments as ESTree.Node[]).includes(current)) return undefined;
      if (isIgnoredReceiver(parent.callee)) return undefined;
      return displayCallee(parent.callee);
    }

    if (
      parent.type === "SpreadElement" ||
      parent.type === "ObjectExpression" ||
      parent.type === "ArrayExpression" ||
      (parent.type === "Property" && parent.value === current) ||
      (parent.type as string) === "TSAsExpression" ||
      (parent.type as string) === "TSNonNullExpression" ||
      (parent.type as string) === "TSSatisfiesExpression" ||
      parent.type === "AwaitExpression"
    ) {
      current = parent;
      continue;
    }

    return undefined;
  }
}

/**
 * Responses and loggers are not data sinks this rule guards: echoing input
 * back is not mass assignment, and logging it is `no-sensitive-log`'s concern.
 */
const IGNORED_RECEIVERS: ReadonlySet<string> = new Set([
  "response",
  "reply",
  "res",
  "console",
  "log",
  "logger",
]);

function isIgnoredReceiver(callee: ESTree.Node): boolean {
  const target = unwrapExpression(callee);
  if (target.type !== "MemberExpression") return false;
  const object = unwrapExpression(target.object);
  return object.type === "Identifier" && IGNORED_RECEIVERS.has(object.name);
}

function displayCallee(callee: ESTree.Node): string {
  const target = unwrapExpression(callee);
  if (target.type === "Identifier") return `${target.name}()`;
  if (target.type === "MemberExpression") {
    const name = propertyName(target);
    const object = unwrapExpression(target.object);
    const owner = object.type === "Identifier" ? `${object.name}.` : "";
    return name ? `${owner}${name}()` : "a call";
  }
  return "a call";
}
