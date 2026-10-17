import type { Codemod, CodemodOutput } from "../types";
import { importedLocalNames, manualAt, replaceNode } from "./helpers";

const SYNC_METHODS = new Set([
  "info",
  "warn",
  "error",
  "debug",
  "success",
  "fatal",
  "log",
  "assert",
]);

/**
 * 5.30: `log.info()` and its siblings return the logger instead of a promise.
 * Removes `await` in front of them; a `.then()` chained on one is listed for
 * review (code that must wait for delivery calls `await log.flush()`).
 */
export const loggerSyncCalls: Codemod = {
  id: "logger-sync-calls",
  version: "5.30.0",
  package: "@warlock.js/logger",
  title: "Remove `await` from synchronous log calls",
  skill: "upgrade-from-5-29",
  run(context) {
    const { Node, SyntaxKind } = context.tsMorph;
    const output: CodemodOutput = { edits: [], manual: [] };

    for (const sourceFile of context.sourceFiles) {
      const loggers = importedLocalNames(sourceFile, "@warlock.js/logger", "log");
      if (loggers.size === 0) continue;

      const isLogCall = (node: import("ts-morph").Node): boolean => {
        if (!Node.isCallExpression(node)) return false;
        const callee = node.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return false;
        const owner = callee.getExpression();
        return (
          Node.isIdentifier(owner) &&
          loggers.has(owner.getText()) &&
          SYNC_METHODS.has(callee.getName())
        );
      };

      for (const awaitExpression of sourceFile.getDescendantsOfKind(SyntaxKind.AwaitExpression)) {
        const argument = awaitExpression.getExpression();
        if (!isLogCall(argument)) continue;
        output.edits.push(
          replaceNode(
            context,
            awaitExpression,
            argument.getText(),
            `removed await before ${argument.getText().split("(")[0]}()`,
          ),
        );
      }

      for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        if (access.getName() !== "then" || !isLogCall(access.getExpression())) continue;
        output.manual.push(
          manualAt(
            context,
            access,
            "`.then()` on a log call: log calls return the logger now. Run the callback directly, or `await log.flush()` first if it must wait for delivery.",
          ),
        );
      }
    }

    return output;
  },
};
