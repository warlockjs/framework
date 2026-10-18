import ts from "typescript";
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
export function requestMemberAccess(node: ts.Node): string | undefined {
  let current = unwrap(node);

  if (ts.isCallExpression(current)) current = unwrap(current.expression);
  if (!isMemberAccess(current)) return undefined;

  // Walk down to the member read directly off the request: `request.query.next` → `query`.
  let member = current;

  for (;;) {
    const object = unwrap(member.expression);

    if (ts.isIdentifier(object)) {
      return REQUEST_NAMES.has(object.text) ? memberName(member) : undefined;
    }

    if (isMemberAccess(object)) {
      member = object;
      continue;
    }

    if (ts.isCallExpression(object)) {
      const callee = unwrap(object.expression);
      if (!isMemberAccess(callee)) return undefined;
      member = callee;
      continue;
    }

    return undefined;
  }
}

/** Whether `node` reads client-controlled input from the request. */
export function isRequestInputExpression(node: ts.Node): boolean {
  const member = requestMemberAccess(node);

  return member !== undefined && REQUEST_INPUT_MEMBERS.has(member);
}

export type TaintOptions = {
  /** Calls whose result is clean, whatever their arguments (matched by name). */
  sanitizers?: ReadonlySet<string>;
  /** Input sources besides the request (client query-string hooks, `location.search`). */
  isSource?: (node: ts.Node) => boolean;
};

function isSanitizerCall(call: ts.CallExpression, sanitizers: ReadonlySet<string>): boolean {
  const callee = unwrap(call.expression);

  if (ts.isIdentifier(callee)) return sanitizers.has(callee.text);

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
  node: ts.Node,
  options: TaintOptions = {},
  seen: Set<ts.Node> = new Set(),
): boolean {
  let found = false;
  const sanitizers = options.sanitizers ?? new Set<string>();

  walk(node, (child) => {
    if (found) return false;

    if (ts.isCallExpression(child) && isSanitizerCall(child, sanitizers)) return false;

    if (isMemberAccess(child) || ts.isCallExpression(child)) {
      if (isRequestInputExpression(child) || options.isSource?.(child) === true) {
        found = true;
        return false;
      }
    }

    if (ts.isIdentifier(child) && !seen.has(child)) {
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
