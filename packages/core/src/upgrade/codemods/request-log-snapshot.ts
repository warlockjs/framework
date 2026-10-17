import type * as TsMorph from "ts-morph";
import type { Codemod, CodemodOutput } from "../types";
import { importedLocalNames, manualAt, replaceNode } from "./helpers";

/** Fields of the `RequestLogSnapshot` a log channel now receives. */
const SNAPSHOT_FIELDS = new Set([
  "id",
  "method",
  "url",
  "route",
  "name",
  "ip",
  "userAgent",
  "query",
  "body",
  "statusCode",
]);

/** `request.<a>.<b>` reads with a snapshot equivalent. */
const REWRITES: Record<string, string> = {
  "baseRequest.url": "url",
  "baseRequest.method": "method",
  "baseRequest.ip": "ip",
  "route.path": "route",
  "route.name": "name",
};

/**
 * 5.30: request log entries carry a plain `RequestLogSnapshot` in
 * `context.request`, not the `Request` instance. Inside custom log channels,
 * rewrites the reads that have a direct snapshot field and lists the rest.
 */
export const requestLogSnapshot: Codemod = {
  id: "request-log-snapshot",
  version: "5.30.0",
  package: "@warlock.js/core",
  title: "Read request log snapshots in custom log channels",
  skill: "upgrade-from-5-29",
  run(context) {
    const { Node, SyntaxKind } = context.tsMorph;
    const output: CodemodOutput = { edits: [], manual: [] };

    for (const sourceFile of context.sourceFiles) {
      if (importedLocalNames(sourceFile, "@warlock.js/logger", "LogChannel").size === 0) continue;

      for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const owner = access.getExpression();
        // `<anything>.context.request` / `.context.response`
        if (!Node.isPropertyAccessExpression(owner) || owner.getName() !== "context") continue;
        const target = access.getName();
        if (target !== "request" && target !== "response") continue;

        const chain = memberChain(Node, access);
        if (chain.length === 0) continue;

        const first = chain[0] as TsMorph.PropertyAccessExpression;
        const second = chain[1];
        const pair = second ? `${first.getName()}.${second.getName()}` : undefined;
        const replacement = pair ? REWRITES[pair] : undefined;

        if (target === "request" && replacement && second) {
          output.edits.push(
            replaceNode(
              context,
              second,
              `${access.getText()}.${replacement}`,
              `context.request.${pair} → context.request.${replacement}`,
            ),
          );
          continue;
        }

        const field = first.getName();
        const isCall = Node.isCallExpression(first.getParent());
        // `route` is the matched pattern string now, not the route object.
        const readsRouteObject = target === "request" && field === "route" && second !== undefined;
        if (!SNAPSHOT_FIELDS.has(field) || isCall || readsRouteObject) {
          output.manual.push(
            manualAt(
              context,
              first,
              `\`context.${target}.${field}\` is not on the log snapshot ({ id, method, url, route, name, ip, userAgent, query?, body? }). Read a snapshot field, or call \`request.toLogSnapshot()\` where the entry is logged.`,
            ),
          );
        }
      }
    }

    return output;
  },
};

/** `x.context.request.a.b` → [`…request.a`, `…request.a.b`]. */
function memberChain(
  Node: typeof TsMorph.Node,
  start: TsMorph.PropertyAccessExpression,
): TsMorph.PropertyAccessExpression[] {
  const chain: TsMorph.PropertyAccessExpression[] = [];
  let current: TsMorph.Node = start;

  for (;;) {
    const parent = current.getParent();
    if (!parent || !Node.isPropertyAccessExpression(parent) || parent.getExpression() !== current) {
      return chain;
    }
    chain.push(parent);
    current = parent;
  }
}
