import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { propertyName, resolveInitializer, unwrapExpression, walk } from "./ast";

/** Identifiers treated as the incoming request when no option overrides them. */
export const DEFAULT_REQUEST_NAMES: readonly string[] = ["request", "req"];

/**
 * Request members that return client-controlled input. Reading any of them
 * (as a property or a call) yields data the client chose.
 */
export const REQUEST_INPUT_MEMBERS: ReadonlySet<string> = new Set([
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

export type RequestNameOptions = {
  requestNames?: string[];
};

/** The request identifiers configured for a rule. */
export function requestNames(options: RequestNameOptions | undefined): ReadonlySet<string> {
  return new Set(options?.requestNames ?? DEFAULT_REQUEST_NAMES);
}

/**
 * When `node` is `<request>.<member>` or `<request>.<member>(…)` (optionally
 * through `request.query.next`-style property chains), return `<member>`.
 */
export function requestMemberAccess(
  node: ESTree.Node,
  names: ReadonlySet<string>,
): string | undefined {
  let current = unwrapExpression(node);

  if (current.type === "CallExpression") current = unwrapExpression(current.callee);
  if (current.type !== "MemberExpression") return undefined;

  // Walk down to the member directly on the request identifier:
  // `request.query.next` → `query`.
  let member: ESTree.MemberExpression = current;
  for (;;) {
    const object = unwrapExpression(member.object);
    if (object.type === "Identifier") {
      return names.has(object.name) ? propertyName(member) : undefined;
    }
    if (object.type === "MemberExpression") {
      member = object;
      continue;
    }
    if (object.type === "CallExpression") {
      const callee = unwrapExpression(object.callee);
      if (callee.type !== "MemberExpression") return undefined;
      member = callee;
      continue;
    }
    return undefined;
  }
}

/** Whether `node` reads client-controlled input from the request. */
export function isRequestInputExpression(node: ESTree.Node, names: ReadonlySet<string>): boolean {
  const member = requestMemberAccess(node, names);
  return member !== undefined && REQUEST_INPUT_MEMBERS.has(member);
}

export type TaintOptions = {
  /** Calls whose result is considered clean, whatever their arguments. */
  sanitizers?: ReadonlySet<string>;
  /** Follow `const x = request.input()` through local constants. Defaults to true. */
  followVariables?: boolean;
  /** Further input sources besides the request (e.g. client query-string hooks). */
  isSource?: (node: ESTree.Node) => boolean;
};

/**
 * Whether an expression carries request input: it reads the request directly,
 * or names a local constant that was initialised from request input. Calls to
 * a sanitizer (matched by name) launder their arguments.
 */
export function containsRequestInput(
  context: Rule.RuleContext,
  node: ESTree.Node,
  names: ReadonlySet<string>,
  options: TaintOptions = {},
  seen: Set<ESTree.Node> = new Set(),
): boolean {
  let found = false;
  const sanitizers = options.sanitizers ?? new Set<string>();

  walk(node, (child) => {
    if (found) return false;

    if (child.type === "CallExpression" && isSanitizerCall(child, sanitizers)) return false;

    if (child.type === "MemberExpression" || child.type === "CallExpression") {
      if (isRequestInputExpression(child, names) || options.isSource?.(child) === true) {
        found = true;
        return false;
      }
    }

    if (child.type === "Identifier" && options.followVariables !== false && !seen.has(child)) {
      seen.add(child);
      if (isIdentifierReference(child)) {
        const init = resolveInitializer(context, child);
        if (init && !seen.has(init)) {
          seen.add(init);
          if (containsRequestInput(context, init, names, options, seen)) {
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

function isSanitizerCall(call: ESTree.CallExpression, sanitizers: ReadonlySet<string>): boolean {
  const callee = unwrapExpression(call.callee);
  if (callee.type === "Identifier") return sanitizers.has(callee.name);
  if (callee.type === "MemberExpression") {
    const name = propertyName(callee);
    return name !== undefined && sanitizers.has(name);
  }
  return false;
}

/**
 * Whether an identifier is a value reference (not the `b` of `a.b`, nor an
 * object key). `walk` reaches property identifiers too, so filter them here.
 */
function isIdentifierReference(identifier: ESTree.Identifier): boolean {
  const parent = (identifier as ESTree.Identifier & { parent?: ESTree.Node }).parent;
  if (!parent) return true;
  if (parent.type === "MemberExpression" && parent.property === identifier && !parent.computed) {
    return false;
  }
  if (parent.type === "Property" && parent.key === identifier && !parent.computed) {
    return parent.shorthand;
  }
  return true;
}
