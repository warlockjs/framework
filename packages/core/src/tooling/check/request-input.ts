import * as ast from "../syntax/ast";
import {
  isMemberAccess,
  isValueReference,
  memberName,
  resolveInitializer,
  unwrap,
  walk,
} from "./source-ast";

/** Identifiers the source checks treat as the incoming request. */
export const REQUEST_NAMES: ReadonlySet<string> = new Set(["request", "req"]);

/**
 * Request members that return client-controlled input. Reading any of them
 * (as a property or a call) yields data the client chose.
 */
const REQUEST_INPUT_MEMBERS: ReadonlySet<string> = new Set([
  "all",
  "allExceptParams",
  "heavy",
  "heavyExceptParams",
  "only",
  "pluck",
  "except",
  "input",
  "get",
  "email",
  "string",
  "int",
  "bool",
  "float",
  "number",
  "body",
  "bodyInputs",
  "params",
  "query",
  "validated",
  "validatedExcept",
  "idParam",
  "headers",
  "header",
  "cookie",
  "cookies",
  "referer",
  "referrer",
]);

/** Request members that return the whole (or most of the) request body. */
export const REQUEST_BODY_MEMBERS: ReadonlySet<string> = new Set([
  "all",
  "allExceptParams",
  "heavy",
  "heavyExceptParams",
  "body",
  "bodyInputs",
  "validated",
  "validatedExcept",
  "only",
  "except",
  "pluck",
  "headers",
  "cookies",
]);

/**
 * When `node` is `<request>.<member>` or `<request>.<member>(…)` (also through
 * `request.query.next`-style chains), the `<member>`.
 */
export function requestMemberAccess(node: ast.Node): string | undefined {
  let current = unwrap(node);

  if (ast.isCallExpression(current)) current = unwrap(ast.expressionOf(current));
  if (!isMemberAccess(current)) return undefined;

  // Walk down to the member read directly off the request: `request.query.next` → `query`.
  let member = current;

  for (;;) {
    const object = unwrap(ast.expressionOf(member));

    if (ast.isIdentifier(object)) {
      return REQUEST_NAMES.has(ast.valueText(object)) ? memberName(member) : undefined;
    }

    if (isMemberAccess(object)) {
      member = object;
      continue;
    }

    if (ast.isCallExpression(object)) {
      const callee = unwrap(ast.expressionOf(object));
      if (!isMemberAccess(callee)) return undefined;
      member = callee;
      continue;
    }

    return undefined;
  }
}

/** Whether `node` reads client-controlled input from the request. */
export function isRequestInputExpression(node: ast.Node): boolean {
  const member = requestMemberAccess(node);

  return member !== undefined && REQUEST_INPUT_MEMBERS.has(member);
}

export type TaintOptions = {
  /** Calls whose result is clean, whatever their arguments (matched by name). */
  sanitizers?: ReadonlySet<string>;
  /** Input sources besides the request (client query-string hooks, `location.search`). */
  isSource?: (node: ast.Node) => boolean;
};

function isSanitizerCall(call: ast.CallExpression, sanitizers: ReadonlySet<string>): boolean {
  const callee = unwrap(ast.expressionOf(call));

  if (ast.isIdentifier(callee)) return sanitizers.has(ast.valueText(callee));

  if (isMemberAccess(callee)) {
    const name = memberName(callee);
    return name !== undefined && sanitizers.has(name);
  }

  return false;
}

/**
 * Whether an expression carries request input: it reads the request directly,
 * or names a local constant initialised from request input. A call to a
 * sanitizer launders its arguments.
 */
export function containsRequestInput(
  node: ast.Node,
  options: TaintOptions = {},
  seen: Set<ast.Node> = new Set(),
): boolean {
  let found = false;
  const sanitizers = options.sanitizers ?? new Set<string>();

  walk(node, (child) => {
    if (found) return false;

    if (ast.isCallExpression(child) && isSanitizerCall(child, sanitizers)) return false;

    if (isMemberAccess(child) || ast.isCallExpression(child)) {
      if (isRequestInputExpression(child) || options.isSource?.(child) === true) {
        found = true;
        return false;
      }
    }

    if (ast.isIdentifier(child) && !seen.has(child)) {
      seen.add(child);

      if (isValueReference(child)) {
        const initializer = resolveInitializer(child);

        if (initializer && !seen.has(initializer)) {
          seen.add(initializer);

          if (containsRequestInput(initializer, options, seen)) {
            found = true;
            return false;
          }
        }
      }
    }

    return undefined;
  });

  return found;
}
