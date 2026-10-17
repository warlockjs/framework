import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { asNode, docsUrl, propertyName, unwrapExpression } from "../utils/ast";

/** Logger methods that return the logger synchronously since 5.30. */
const SYNC_METHODS: ReadonlySet<string> = new Set([
  "info",
  "warn",
  "error",
  "debug",
  "success",
  "fatal",
  "log",
  "assert",
]);

export type NoAwaitLogOptions = {
  loggerNames?: string[];
};

/**
 * `log.info()` and its siblings return the logger, not a promise, so awaiting
 * them only adds a microtask and suggests a delivery guarantee that does not
 * exist. Code that must wait for delivery calls `await log.flush()`.
 */
export const noAwaitLog: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow `await` on synchronous `log.*` calls",
      recommended: true,
      url: docsUrl("no-await-log"),
    },
    fixable: "code",
    schema: [
      {
        type: "object",
        properties: {
          loggerNames: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unnecessary:
        "`{{call}}()` returns the logger synchronously; `await` does nothing here. Remove it (use `await log.flush()` to wait for delivery).",
    },
  },

  create(context) {
    const options = (context.options[0] ?? {}) as NoAwaitLogOptions;
    const loggers = new Set(options.loggerNames ?? ["log", "logger"]);
    const sourceCode = context.sourceCode;

    return {
      AwaitExpression(listenerNode) {
        const node = asNode(listenerNode) as ESTree.AwaitExpression;
        const argument = unwrapExpression(node.argument);
        if (argument.type !== "CallExpression") return;

        const callee = unwrapExpression(argument.callee);
        if (callee.type !== "MemberExpression") return;
        const owner = unwrapExpression(callee.object);
        if (owner.type !== "Identifier" || !loggers.has(owner.name)) return;
        const method = propertyName(callee);
        if (!method || !SYNC_METHODS.has(method)) return;

        context.report({
          node,
          messageId: "unnecessary",
          data: { call: `${owner.name}.${method}` },
          fix: (fixer) => fixer.replaceText(node, sourceCode.getText(node.argument)),
        });
      },
    };
  },
};
