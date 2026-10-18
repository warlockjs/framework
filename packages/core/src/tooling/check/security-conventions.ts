import { DEFAULT_REDACT_KEY_SET, normalizeRedactKey } from "@warlock.js/logger";
import ts from "typescript";
import { isAuthGuardName, isMutatingHttpMethod } from "../../router/route-guard-names";
import {
  containsRequestInput,
  REQUEST_BODY_MEMBERS,
  REQUEST_NAMES,
  requestMemberAccess,
} from "./request-input";
import {
  ancestors,
  calleeName,
  isFunctionLike,
  isMemberAccess,
  keyName,
  literalString,
  memberName,
  referencesOf,
  resolveInitializer,
  rootIdentifier,
  type SourceFinding,
  unwrap,
  walk,
} from "./source-ast";

// ── WL9005: request.all() into a query, a service or inApp() ────────────────

/** Request methods that return every input the client sent, validated or not. */
const UNFILTERED_METHODS: ReadonlySet<string> = new Set([
  "all",
  "allExceptParams",
  "heavy",
  "heavyExceptParams",
]);

/**
 * Responses and loggers are not the data sinks `WL9005` guards: echoing input
 * back is not mass assignment, and logging it is `WL9008`'s concern.
 */
const IGNORED_RECEIVERS: ReadonlySet<string> = new Set([
  "response",
  "reply",
  "res",
  "console",
  "log",
  "logger",
]);

function displayCallee(callee: ts.Node): string {
  const target = unwrap(callee);

  if (ts.isIdentifier(target)) return `${target.text}()`;

  if (isMemberAccess(target)) {
    const name = memberName(target);
    const object = unwrap(target.expression);
    const owner = ts.isIdentifier(object) ? `${object.text}.` : "";

    return name ? `${owner}${name}()` : "a call";
  }

  return "a call";
}

function isIgnoredReceiver(callee: ts.Node): boolean {
  const target = unwrap(callee);

  if (!isMemberAccess(target)) return false;

  const object = unwrap(target.expression);

  return ts.isIdentifier(object) && IGNORED_RECEIVERS.has(object.text);
}

/** When `node` flows into a call's arguments, the callee's display name. */
function callReceiving(node: ts.Node): string | undefined {
  let current = node;

  for (;;) {
    const parent = current.parent;

    if (!parent) return undefined;

    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      if (!(parent.arguments ?? []).some((argument) => argument === current)) return undefined;
      if (isIgnoredReceiver(parent.expression)) return undefined;

      return displayCallee(parent.expression);
    }

    if (
      ts.isSpreadElement(parent) ||
      ts.isSpreadAssignment(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === current) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isAwaitExpression(parent)
    ) {
      current = parent;
      continue;
    }

    return undefined;
  }
}

/**
 * The call that ends up receiving this value: directly as an argument, spread
 * into an object/array argument, or through a local constant later passed to
 * a call.
 */
function receivingCall(node: ts.Node): string | undefined {
  const direct = callReceiving(node);

  if (direct) return direct;

  // `const data = request.all(); await Model.create(data);`
  const parent = node.parent;

  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === node &&
    ts.isIdentifier(parent.name)
  ) {
    for (const reference of referencesOf(parent)) {
      const name = callReceiving(reference);
      if (name) return name;
    }
  }

  return undefined;
}

function checkRequestAll(node: ts.Node, findings: SourceFinding[]): void {
  if (!ts.isCallExpression(node)) return;

  const callee = unwrap(node.expression);

  if (!isMemberAccess(callee)) return;

  const object = unwrap(callee.expression);

  if (!ts.isIdentifier(object) || !REQUEST_NAMES.has(object.text)) return;

  const method = memberName(callee);

  if (!method || !UNFILTERED_METHODS.has(method)) return;

  const target = receivingCall(node);

  if (!target) return;

  findings.push({
    code: "WL9005",
    node,
    message: `\`${object.text}.${method}()\` passes every client-sent field to \`${target}\`. Use \`${object.text}.validated()\` so only the fields the validation schema accepted reach it.`,
  });
}

// ── WL9006: a mutating route with no auth guard and no public: true ─────────

const ROUTER_NAMES: ReadonlySet<string> = new Set(["router"]);

/** Wrappers whose callback routes are guarded, e.g. `guarded(() => …)`. */
const GUARD_FUNCTIONS: ReadonlySet<string> = new Set(["guarded"]);

/** `router.post(…)` and friends. */
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

function isRouter(node: ts.Node): boolean {
  const target = unwrap(node);

  return ts.isIdentifier(target) && ROUTER_NAMES.has(target.text);
}

function isGuardName(name: string | undefined): boolean {
  return name !== undefined && isAuthGuardName(name);
}

/** Whether a constant is initialised with `markAuthGuard(fn)` (not `markAuthGuard(fn, false)`). */
function isMarkedGuard(identifier: ts.Identifier): boolean {
  const initializer = resolveInitializer(identifier);
  const value = initializer ? unwrap(initializer) : undefined;

  return (
    value !== undefined &&
    ts.isCallExpression(value) &&
    calleeName(value) === "markAuthGuard" &&
    value.arguments[1]?.kind !== ts.SyntaxKind.FalseKeyword
  );
}

function middlewareHasGuard(node: ts.Node): boolean {
  const value = unwrap(node);

  // A variable or a call: the check cannot see into it, so it trusts it.
  if (!ts.isArrayLiteralExpression(value)) return true;

  return value.elements.some((element) => {
    if (ts.isSpreadElement(element)) return true;

    const item = unwrap(element);

    if (ts.isIdentifier(item)) return isGuardName(item.text) || isMarkedGuard(item);
    if (ts.isCallExpression(item)) return isGuardName(calleeName(item));
    if (isMemberAccess(item)) return isGuardName(memberName(item));

    return false;
  });
}

/** `public: true`, a guard in `middleware`, or an options value the check cannot see into. */
function optionsGuard(node: ts.Node | undefined): "guarded" | "unguarded" | "none" {
  if (!node) return "none";

  const value = unwrap(node);

  if (!ts.isObjectLiteralExpression(value)) return "guarded";

  let verdict: "guarded" | "unguarded" = "unguarded";

  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      verdict = "guarded";
      continue;
    }

    let key: string | undefined;
    let propertyValue: ts.Node | undefined;

    if (ts.isPropertyAssignment(property)) {
      key = keyName(property.name);
      propertyValue = unwrap(property.initializer);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      key = property.name.text;
      propertyValue = property.name;
    }

    if (!propertyValue) continue;
    if (key === "public" && propertyValue.kind === ts.SyntaxKind.TrueKeyword) return "guarded";
    if (key === "middleware" && middlewareHasGuard(propertyValue)) return "guarded";
  }

  return verdict;
}

/** Whether an enclosing function is a guarded (or public) group callback. */
function insideGuardedGroup(node: ts.Node): boolean {
  for (const ancestor of ancestors(node)) {
    if (!ts.isArrowFunction(ancestor) && !ts.isFunctionExpression(ancestor)) continue;

    const parent = ancestor.parent;

    if (!parent || !ts.isCallExpression(parent)) continue;
    if (!parent.arguments.some((argument) => argument === ancestor)) continue;

    const name = calleeName(parent);

    if (name !== undefined && GUARD_FUNCTIONS.has(name)) return true;

    const callee = unwrap(parent.expression);

    if (
      isMemberAccess(callee) &&
      memberName(callee) === "group" &&
      isRouter(callee.expression) &&
      optionsGuard(parent.arguments[0]) === "guarded"
    ) {
      return true;
    }
  }

  return false;
}

function pathText(node: ts.Node | undefined): string {
  return literalString(node) ?? "(dynamic path)";
}

/**
 * Walk a builder chain back to `router.route(path, options)`, collecting every
 * options object passed along the way (`route()`, `nest()`).
 */
function builderChain(node: ts.Node): { path: string; optionNodes: ts.Node[] } | undefined {
  const optionNodes: ts.Node[] = [];
  let current = unwrap(node);

  while (ts.isCallExpression(current)) {
    const callee = unwrap(current.expression);

    if (!isMemberAccess(callee)) return undefined;

    const name = memberName(callee);

    if (name === "route" && isRouter(callee.expression)) {
      const options = current.arguments[1];
      if (options) optionNodes.push(options);

      return { path: pathText(current.arguments[0]), optionNodes };
    }

    if (name === "nest") {
      const options = current.arguments[1];
      if (options) optionNodes.push(options);
    }

    current = unwrap(callee.expression);
  }

  return undefined;
}

function resourceIsReadOnly(node: ts.Node | undefined): boolean {
  if (!node) return false;

  const value = unwrap(node);

  if (!ts.isObjectLiteralExpression(value)) return false;

  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property) || keyName(property.name) !== "only") continue;

    const only = unwrap(property.initializer);

    if (!ts.isArrayLiteralExpression(only)) return false;

    return only.elements.every((element) => {
      const method = literalString(element);
      return method !== undefined && READ_ONLY_RESOURCE_METHODS.has(method);
    });
  }

  return false;
}

function unguardedRoute(node: ts.Node, route: string): SourceFinding {
  return {
    code: "WL9006",
    node,
    message: `Mutating route \`${route}\` has no auth middleware. Add an auth guard (\`middleware: [authMiddleware()]\`, or register it inside a guarded group) or mark it intentionally open with \`public: true\`.`,
  };
}

function checkRouteGuard(node: ts.Node, findings: SourceFinding[]): void {
  if (!ts.isCallExpression(node)) return;

  const callee = unwrap(node.expression);

  if (!isMemberAccess(callee)) return;

  const method = memberName(callee);

  if (!method) return;

  const guarded = (options: ts.Node | undefined) =>
    optionsGuard(options) === "guarded" || insideGuardedGroup(node);

  if (isRouter(callee.expression)) {
    // router.post(path, handler, options)
    if (MUTATING_ROUTER_METHODS.has(method)) {
      if (!guarded(node.arguments[2])) {
        findings.push(
          unguardedRoute(node, `${method.toUpperCase()} ${pathText(node.arguments[0])}`),
        );
      }

      return;
    }

    // router.add("POST", path, handler, options)
    if (method === "add") {
      const httpMethod = literalString(node.arguments[0])?.toUpperCase();

      if (!httpMethod || !isMutatingHttpMethod(httpMethod)) return;

      if (!guarded(node.arguments[3])) {
        findings.push(unguardedRoute(node, `${httpMethod} ${pathText(node.arguments[1])}`));
      }

      return;
    }

    // router.restfulResource(path, resource, options)
    if (method === "restfulResource") {
      if (resourceIsReadOnly(node.arguments[2])) return;

      if (!guarded(node.arguments[2])) {
        findings.push(unguardedRoute(node, `resource ${pathText(node.arguments[0])}`));
      }
    }

    return;
  }

  // router.route(path, options).create(handler, options)
  if (!MUTATING_BUILDER_METHODS.has(method)) return;

  const chain = builderChain(callee.expression);

  if (!chain) return;
  if (optionsGuard(node.arguments[1]) === "guarded") return;
  if (chain.optionNodes.some((options) => optionsGuard(options) === "guarded")) return;
  if (insideGuardedGroup(node)) return;

  findings.push(unguardedRoute(node, `${method} ${chain.path}`));
}

// ── WL9007: a redirect or link target from request input ────────────────────

/** Calls that turn their first argument into a redirect or a navigation. */
const REDIRECT_CALLS: ReadonlySet<string> = new Set([
  "redirect",
  "permanentRedirect",
  "navigateTo",
]);

/** Components whose `to`/`href` prop navigates. */
const LINK_COMPONENTS: ReadonlySet<string> = new Set(["Link", "NavLink"]);

/** Helpers that return an allowed target (or a fallback) for any input. */
const REDIRECT_SANITIZERS: ReadonlySet<string> = new Set(["safeRedirect", "safeRedirectTarget"]);

/** Predicates that, used in an enclosing `if` or `? :`, prove the target was checked. */
const REDIRECT_VALIDATORS: ReadonlySet<string> = new Set(["isSafeRedirect", "isSafeRedirectUrl"]);

/** Client-side input: query-string hooks. */
const CLIENT_INPUT_CALLS: ReadonlySet<string> = new Set([
  "useQueryString",
  "useSearchParams",
  "useParams",
]);

/** Identifiers whose members are client-controlled (a loader's `query`, URLSearchParams). */
const CLIENT_INPUT_NAMES: ReadonlySet<string> = new Set(["query", "searchParams"]);

function isClientSource(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const name = calleeName(node);
    if (name !== undefined && CLIENT_INPUT_CALLS.has(name)) return true;
  }

  if (isMemberAccess(node)) {
    const root = rootIdentifier(node);

    if (root && CLIENT_INPUT_NAMES.has(root.text)) return true;

    // location.search / window.location.hash
    const name = memberName(node);

    if (name === "search" || name === "hash") {
      const object = unwrap(node.expression);

      if (ts.isIdentifier(object) && object.text === "location") return true;
      if (isMemberAccess(object) && memberName(object) === "location") return true;
    }
  }

  return false;
}

function isRedirectTainted(node: ts.Node): boolean {
  return containsRequestInput(node, { sanitizers: REDIRECT_SANITIZERS, isSource: isClientSource });
}

/** An enclosing `if (isSafeRedirect(x))` or `isSafeRedirect(x) ? … : …` validated the target. */
function checkedByValidator(node: ts.Node): boolean {
  for (const ancestor of ancestors(node)) {
    let test: ts.Node | undefined;

    if (ts.isIfStatement(ancestor)) test = ancestor.expression;
    else if (ts.isConditionalExpression(ancestor)) test = ancestor.condition;
    else continue;

    let validated = false;

    walk(test, (child) => {
      if (ts.isCallExpression(child)) {
        const name = calleeName(child);
        if (name !== undefined && REDIRECT_VALIDATORS.has(name)) validated = true;
      }

      return undefined;
    });

    if (validated) return true;
  }

  return false;
}

function unsafeRedirect(node: ts.Node, what: string, helper: string, from: string): SourceFinding {
  return {
    code: "WL9007",
    node,
    message: `This ${what} target comes from request input. Pass it through \`${helper}()\` from \`${from}\` so only same-origin paths and allow-listed origins are followed (open redirects and \`javascript:\` URLs otherwise).`,
  };
}

function checkRedirect(node: ts.Node, findings: SourceFinding[]): void {
  if (ts.isCallExpression(node)) {
    const name = calleeName(node);

    if (name === undefined || !REDIRECT_CALLS.has(name)) return;

    // `router.redirect(from, to)` registers a static redirect, not a request-time one.
    const callee = unwrap(node.expression);

    if (isMemberAccess(callee)) {
      const owner = unwrap(callee.expression);
      if (ts.isIdentifier(owner) && owner.text === "router") return;
    }

    const target = node.arguments[0];

    if (!target || ts.isSpreadElement(target)) return;
    if (!isRedirectTainted(target) || checkedByValidator(node)) return;

    findings.push(
      name === "navigateTo"
        ? unsafeRedirect(target, "navigation", "safeRedirectTarget", "@warlock.js/web")
        : unsafeRedirect(target, "redirect", "safeRedirect", "@warlock.js/core"),
    );

    return;
  }

  if (!ts.isJsxAttribute(node) || !ts.isIdentifier(node.name)) return;
  if (node.name.text !== "to" && node.name.text !== "href") return;

  const element = node.parent.parent;

  if (!ts.isJsxOpeningElement(element) && !ts.isJsxSelfClosingElement(element)) return;
  if (!ts.isIdentifier(element.tagName) || !LINK_COMPONENTS.has(element.tagName.text)) return;

  const initializer = node.initializer;

  if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return;

  const expression = initializer.expression;

  if (!isRedirectTainted(expression) || checkedByValidator(expression)) return;

  findings.push(unsafeRedirect(expression, "link", "safeRedirectTarget", "@warlock.js/web"));
}

// ── WL9008: raw emails, credentials and request bodies in logs ──────────────

const LOGGER_NAMES: ReadonlySet<string> = new Set(["log", "logger", "console"]);

const LOG_METHODS: ReadonlySet<string> = new Set([
  "info",
  "warn",
  "error",
  "debug",
  "success",
  "fatal",
  "log",
  "assert",
  "trace",
]);

/** Helpers that make a value safe to log; their arguments are not inspected. */
const REDACTORS: ReadonlySet<string> = new Set([
  "maskEmail",
  "maskEmailsInText",
  "redact",
  "redactHeaders",
  "redactError",
  "redactUrlCredentials",
  "redactQueryCredentials",
  "escapeLogValue",
  "toLogSnapshot",
]);

/** Name endings that mark a value as a credential. */
const SECRET_SUFFIXES = [
  "token",
  "password",
  "passwd",
  "secret",
  "apikey",
  "authorization",
  "cookie",
  "cookies",
  "otp",
  "jwt",
  "privatekey",
];

/**
 * Whether the logger censors this key by default (`DEFAULT_REDACT_KEYS` from
 * `@warlock.js/logger`). A secret logged under one of them never reaches a
 * channel. Emails are not on that list: they are not censored by default.
 */
function isCensoredKey(key: string): boolean {
  return DEFAULT_REDACT_KEY_SET.has(normalizeRedactKey(key));
}

/** `email` for addresses, `secret` for credentials, otherwise `undefined`. */
function sensitiveCategory(name: string): "email" | "secret" | undefined {
  const normalized = normalizeRedactKey(name);

  if (normalized.endsWith("email") || normalized.endsWith("emailaddress")) return "email";
  if (DEFAULT_REDACT_KEY_SET.has(normalized)) return "secret";
  if (SECRET_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return "secret";

  return undefined;
}

function describeCategory(category: "email" | "secret", name: string | undefined): string {
  if (category === "email") return "a raw email address";

  return name ? `the credential \`${name}\`` : "a credential";
}

function describeMember(member: string): string {
  if (member === "headers" || member === "cookies") return member;

  return `body (\`${member}\`)`;
}

/** `request.all()` / `request.body` itself, not `request.body.title`. */
function isWholeAccess(node: ts.Node, member: string): boolean {
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    return isMemberAccess(callee) && memberName(callee) === member;
  }

  return isMemberAccess(node) && memberName(node) === member;
}

type LogFinding = { node: ts.Node; what: string };

function inspectLogged(node: ts.Node, censoredKey: boolean, found: LogFinding[]): void {
  const value = unwrap(node);

  if (isFunctionLike(value)) return;

  if (ts.isCallExpression(value)) {
    const name = calleeName(value);
    if (name !== undefined && REDACTORS.has(name)) return;
  }

  // request.all() / request.body / request.headers / request.input("email")
  if (ts.isCallExpression(value) || isMemberAccess(value)) {
    const member = requestMemberAccess(value);

    if (member !== undefined && isWholeAccess(value, member)) {
      if (REQUEST_BODY_MEMBERS.has(member)) {
        found.push({ node: value, what: `the request ${describeMember(member)}` });
        return;
      }

      if (member === "email") {
        found.push({ node: value, what: "a raw email address" });
        return;
      }
    }

    if (ts.isCallExpression(value) && member !== undefined) {
      const key = literalString(value.arguments[0]);
      const category = key ? sensitiveCategory(key) : undefined;

      if (category && !(censoredKey && category === "secret")) {
        found.push({ node: value, what: describeCategory(category, key) });
        return;
      }
    }
  }

  if (ts.isIdentifier(value) || isMemberAccess(value)) {
    const name = ts.isIdentifier(value) ? value.text : memberName(value);
    const category = name ? sensitiveCategory(name) : undefined;

    if (category && !(censoredKey && category === "secret")) {
      found.push({ node: value, what: describeCategory(category, name) });
      return;
    }

    // `request.body.title` reads one field; only the whole body is reported.
    if (isMemberAccess(value) && requestMemberAccess(value) === undefined) {
      inspectLogged(value.expression, false, found);

      if (ts.isElementAccessExpression(value))
        inspectLogged(value.argumentExpression, false, found);
    }

    return;
  }

  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        inspectLogged(property.expression, false, found);
      } else if (ts.isPropertyAssignment(property)) {
        const key = keyName(property.name);
        inspectLogged(property.initializer, key !== undefined && isCensoredKey(key), found);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        inspectLogged(property.name, isCensoredKey(property.name.text), found);
      }
    }

    return;
  }

  if (ts.isTemplateExpression(value)) {
    for (const span of value.templateSpans) inspectLogged(span.expression, false, found);
    return;
  }

  if (ts.isBinaryExpression(value)) {
    inspectLogged(value.left, false, found);
    inspectLogged(value.right, false, found);
    return;
  }

  if (ts.isConditionalExpression(value)) {
    inspectLogged(value.whenTrue, censoredKey, found);
    inspectLogged(value.whenFalse, censoredKey, found);
    return;
  }

  if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      if (ts.isOmittedExpression(element)) continue;
      inspectLogged(ts.isSpreadElement(element) ? element.expression : element, false, found);
    }

    return;
  }

  if (ts.isCallExpression(value)) {
    // JSON.stringify(request.all()), String(user.email), user.email.trim()
    const callee = unwrap(value.expression);

    if (isMemberAccess(callee)) inspectLogged(callee.expression, false, found);

    for (const argument of value.arguments) {
      inspectLogged(ts.isSpreadElement(argument) ? argument.expression : argument, false, found);
    }

    return;
  }

  if (ts.isAwaitExpression(value)) inspectLogged(value.expression, censoredKey, found);
}

function checkSensitiveLog(node: ts.Node, findings: SourceFinding[]): void {
  if (!ts.isCallExpression(node)) return;

  const callee = unwrap(node.expression);

  if (!isMemberAccess(callee)) return;

  const method = memberName(callee);

  if (!method || !LOG_METHODS.has(method)) return;

  const owner = unwrap(callee.expression);

  if (!ts.isIdentifier(owner)) return;

  // log.info(…), console.log(…), and request.log(…)
  const isLogger =
    LOGGER_NAMES.has(owner.text) || (REQUEST_NAMES.has(owner.text) && method === "log");

  if (!isLogger) return;

  const found: LogFinding[] = [];

  for (const argument of node.arguments) {
    inspectLogged(ts.isSpreadElement(argument) ? argument.expression : argument, false, found);
  }

  for (const finding of found) {
    findings.push({
      code: "WL9008",
      node: finding.node,
      message: `Do not log ${finding.what} as-is. Pass it through a redaction helper (\`maskEmail()\`, \`redact()\`, \`request.toLogSnapshot()\`), or log it under a key the logger censors.`,
    });
  }
}

// ── WL9009: unbounded regex quantifiers on request input ────────────────────

/** `regex.test(input)` / `regex.exec(input)`. */
const REGEX_METHODS: ReadonlySet<string> = new Set(["test", "exec"]);

/** `input.match(regex)` and friends: the regex is the first argument. */
const STRING_METHODS: ReadonlySet<string> = new Set([
  "match",
  "matchAll",
  "replace",
  "replaceAll",
  "search",
  "split",
]);

/**
 * The first unbounded quantifier in a regex source (`*`, `+`, `{n,}`), skipping
 * escapes and character classes, or `undefined` when every repetition is
 * bounded.
 */
export function findUnboundedQuantifier(source: string): string | undefined {
  let inClass = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];

    if (char === "\\") {
      index++;
      continue;
    }

    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }

    if (char === "[") {
      inClass = true;
      continue;
    }

    if (char === "*" || char === "+") {
      return `${char}${source[index + 1] === "?" ? "?" : ""}`;
    }

    if (char === "{") {
      const match = /^\{(\d+),\}/.exec(source.slice(index));
      if (match) return match[0];
    }
  }

  return undefined;
}

/** The pattern of a regex literal, `new RegExp("…")`, or a constant holding either. */
function regexSource(node: ts.Node | undefined, depth = 0): string | undefined {
  if (!node || depth > 8) return undefined;

  const value = unwrap(node);

  if (ts.isRegularExpressionLiteral(value)) {
    return value.text.slice(1, value.text.lastIndexOf("/"));
  }

  if (
    (ts.isNewExpression(value) || ts.isCallExpression(value)) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "RegExp"
  ) {
    return literalString(value.arguments?.[0]);
  }

  if (ts.isIdentifier(value)) {
    const initializer = resolveInitializer(value);
    return initializer ? regexSource(initializer, depth + 1) : undefined;
  }

  return undefined;
}

function checkUnboundedRegex(node: ts.Node, findings: SourceFinding[]): void {
  if (!ts.isCallExpression(node)) return;

  const callee = unwrap(node.expression);

  if (!isMemberAccess(callee)) return;

  const method = memberName(callee);

  if (!method) return;

  const first = node.arguments[0];
  const firstArgument = first && !ts.isSpreadElement(first) ? first : undefined;
  let regex: ts.Node | undefined;
  let input: ts.Node | undefined;

  if (REGEX_METHODS.has(method)) {
    regex = callee.expression;
    input = firstArgument;
  } else if (STRING_METHODS.has(method)) {
    regex = firstArgument;
    input = callee.expression;
  } else {
    return;
  }

  if (!input) return;

  const source = regexSource(regex);

  if (source === undefined) return;

  const quantifier = findUnboundedQuantifier(source);

  if (!quantifier || !containsRequestInput(input)) return;

  findings.push({
    code: "WL9009",
    node,
    message: `This regex has an unbounded quantifier (\`${quantifier}\`) and runs on request input, so a crafted input can make it backtrack for a long time (ReDoS). Bound the repetition, e.g. \`{1,256}\`, or cap the input length before matching.`,
  });
}

/**
 * The security conventions in one parsed file:
 *
 * - `WL9005` `request.all()` (or `heavy()`, `allExceptParams()`) passed to a
 *   query, a service or `inApp()`;
 * - `WL9006` a POST/PUT/PATCH/DELETE route with no auth middleware and no
 *   `public: true`;
 * - `WL9007` a `redirect()` / `navigateTo()` / `<Link to|href>` target taken
 *   from request input without `safeRedirect()` / `safeRedirectTarget()` or an
 *   `isSafeRedirect()` check;
 * - `WL9008` a raw email, credential or request body passed to a logger;
 * - `WL9009` a regex with an unbounded quantifier run on request input.
 */
export function securityFindings(sourceFile: ts.SourceFile): SourceFinding[] {
  const findings: SourceFinding[] = [];

  walk(
    sourceFile,
    (node) => {
      checkRequestAll(node, findings);
      checkRouteGuard(node, findings);
      checkRedirect(node, findings);
      checkSensitiveLog(node, findings);
      checkUnboundedRegex(node, findings);

      return undefined;
    },
    true,
  );

  return findings;
}
