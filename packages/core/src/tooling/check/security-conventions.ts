import { DEFAULT_REDACT_KEY_SET, normalizeRedactKey } from "@warlock.js/logger";
import * as ast from "../syntax/ast";
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

function displayCallee(callee: ast.Node): string {
  const target = unwrap(callee);

  if (ast.isIdentifier(target)) return `${ast.valueText(target)}()`;

  if (isMemberAccess(target)) {
    const name = memberName(target);
    const object = unwrap(ast.expressionOf(target));
    const owner = ast.isIdentifier(object) ? `${ast.valueText(object)}.` : "";

    return name ? `${owner}${name}()` : "a call";
  }

  return "a call";
}

function isIgnoredReceiver(callee: ast.Node): boolean {
  const target = unwrap(callee);

  if (!isMemberAccess(target)) return false;

  const object = unwrap(ast.expressionOf(target));

  return ast.isIdentifier(object) && IGNORED_RECEIVERS.has(ast.valueText(object));
}

/** When `node` flows into a call's arguments, the callee's display name. */
function callReceiving(node: ast.Node): string | undefined {
  let current = node;

  for (;;) {
    const parent = ast.parentOf(current);

    if (!parent) return undefined;

    if (ast.isCallExpression(parent) || ast.isNewExpression(parent)) {
      if (!(parent.arguments ?? []).some((argument) => argument === current)) return undefined;
      if (isIgnoredReceiver(ast.expressionOf(parent))) return undefined;

      return displayCallee(ast.expressionOf(parent));
    }

    if (
      ast.isSpreadElement(parent) ||
      ast.isSpreadAssignment(parent) ||
      ast.isObjectLiteralExpression(parent) ||
      ast.isArrayLiteralExpression(parent) ||
      (ast.isPropertyAssignment(parent) && parent.value === current) ||
      ast.isShorthandPropertyAssignment(parent) ||
      ast.isAsExpression(parent) ||
      ast.isNonNullExpression(parent) ||
      ast.isSatisfiesExpression(parent) ||
      ast.isTypeAssertionExpression(parent) ||
      ast.isParenthesizedExpression(parent) ||
      ast.isAwaitExpression(parent)
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
function receivingCall(node: ast.Node): string | undefined {
  const direct = callReceiving(node);

  if (direct) return direct;

  // `const data = request.all(); await Model.create(data);`
  const parent = ast.parentOf(node);

  if (
    parent &&
    ast.isVariableDeclaration(parent) &&
    parent.init === node &&
    ast.isIdentifier(parent.id)
  ) {
    for (const reference of referencesOf(parent)) {
      const name = callReceiving(reference);
      if (name) return name;
    }
  }

  return undefined;
}

function checkRequestAll(node: ast.Node, findings: SourceFinding[]): void {
  if (!ast.isCallExpression(node)) return;

  const callee = unwrap(ast.expressionOf(node));

  if (!isMemberAccess(callee)) return;

  const object = unwrap(ast.expressionOf(callee));

  if (!ast.isIdentifier(object) || !REQUEST_NAMES.has(ast.valueText(object))) return;

  const method = memberName(callee);

  if (!method || !UNFILTERED_METHODS.has(method)) return;

  const target = receivingCall(node);

  if (!target) return;

  findings.push({
    code: "WL9005",
    node,
    message: `\`${ast.valueText(object)}.${method}()\` passes every client-sent field to \`${target}\`. Use \`${ast.valueText(object)}.validated()\` so only the fields the validation schema accepted reach it.`,
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

function isRouter(node: ast.Node): boolean {
  const target = unwrap(node);

  return ast.isIdentifier(target) && ROUTER_NAMES.has(ast.valueText(target));
}

function isGuardName(name: string | undefined): boolean {
  return name !== undefined && isAuthGuardName(name);
}

/** Whether a constant is initialised with `markAuthGuard(fn)` (not `markAuthGuard(fn, false)`). */
function isMarkedGuard(identifier: ast.Identifier): boolean {
  const initializer = resolveInitializer(identifier);
  const value = initializer ? unwrap(initializer) : undefined;

  return (
    value !== undefined &&
    ast.isCallExpression(value) &&
    calleeName(value) === "markAuthGuard" &&
    !(value.arguments[1]?.type === "Literal" && value.arguments[1].value === false)
  );
}

/**
 * Whether a call such as `requireAdmin()` invokes a local factory
 * (`const requireAdmin = () => markAuthGuard(fn)`) whose body declares the
 * middleware it returns an auth guard. A name that says nothing about guards
 * (`requireAdmin`) still counts once the factory marks itself.
 */
function isMarkedGuardFactory(call: ast.CallExpression): boolean {
  const callee = unwrap(ast.expressionOf(call));

  if (!ast.isIdentifier(callee)) return false;

  const initializer = resolveInitializer(callee);

  if (!initializer || !isFunctionLike(unwrap(initializer))) return false;

  let marked = false;

  walk(
    initializer,
    (node) => {
      if (
        ast.isCallExpression(node) &&
        calleeName(node) === "markAuthGuard" &&
        !(node.arguments[1]?.type === "Literal" && node.arguments[1].value === false)
      ) {
        marked = true;
      }

      return marked ? false : undefined;
    },
    true,
  );

  return marked;
}

function middlewareHasGuard(node: ast.Node): boolean {
  const value = unwrap(node);

  // A variable or a call: the check cannot see into it, so it trusts it.
  if (!ast.isArrayLiteralExpression(value)) return true;

  return value.elements.some((element) => {
    if (!element) return false;
    if (ast.isSpreadElement(element)) return true;

    const item = unwrap(element);

    if (ast.isIdentifier(item)) return isGuardName(ast.valueText(item)) || isMarkedGuard(item);
    if (ast.isCallExpression(item)) {
      // `markAuthGuard(fn, false)` declares the opposite: not a guard.
      const optedOut =
        calleeName(item) === "markAuthGuard" &&
        item.arguments[1]?.type === "Literal" &&
        item.arguments[1].value === false;

      return !optedOut && (isGuardName(calleeName(item)) || isMarkedGuardFactory(item));
    }
    if (isMemberAccess(item)) return isGuardName(memberName(item));

    return false;
  });
}

/** `public: true`, a guard in `middleware`, or an options value the check cannot see into. */
function optionsGuard(node: ast.Node | undefined): "guarded" | "unguarded" | "none" {
  if (!node) return "none";

  const value = unwrap(node);

  if (!ast.isObjectLiteralExpression(value)) return "guarded";

  let verdict: "guarded" | "unguarded" = "unguarded";

  for (const property of value.properties) {
    if (ast.isSpreadAssignment(property)) {
      verdict = "guarded";
      continue;
    }

    let key: string | undefined;
    let propertyValue: ast.Node | undefined;

    if (ast.isPropertyAssignment(property)) {
      key = keyName(property.key);
      propertyValue = unwrap(property.value);
    } else if (ast.isShorthandPropertyAssignment(property)) {
      key = ast.valueText(property.key);
      propertyValue = property.key;
    }

    if (!propertyValue) continue;
    if (key === "public" && propertyValue.type === "Literal" && propertyValue.value === true)
      return "guarded";
    if (key === "middleware" && middlewareHasGuard(propertyValue)) return "guarded";
  }

  return verdict;
}

/** Whether an enclosing function is a guarded (or public) group callback. */
function insideGuardedGroup(node: ast.Node): boolean {
  for (const ancestor of ancestors(node)) {
    if (!ast.isArrowFunction(ancestor) && !ast.isFunctionExpression(ancestor)) continue;

    const parent = ast.parentOf(ancestor);

    if (!parent || !ast.isCallExpression(parent)) continue;
    if (!parent.arguments.some((argument) => argument === ancestor)) continue;

    const name = calleeName(parent);

    if (name !== undefined && GUARD_FUNCTIONS.has(name)) return true;

    const callee = unwrap(ast.expressionOf(parent));

    if (
      isMemberAccess(callee) &&
      memberName(callee) === "group" &&
      isRouter(ast.expressionOf(callee)) &&
      optionsGuard(parent.arguments[0]) === "guarded"
    ) {
      return true;
    }
  }

  return false;
}

function pathText(node: ast.Node | undefined): string {
  return literalString(node) ?? "(dynamic path)";
}

/**
 * Walk a builder chain back to `router.route(path, options)`, collecting every
 * options object passed along the way (`route()`, `nest()`).
 */
function builderChain(node: ast.Node): { path: string; optionNodes: ast.Node[] } | undefined {
  const optionNodes: ast.Node[] = [];
  let current = unwrap(node);

  while (ast.isCallExpression(current)) {
    const callee = unwrap(ast.expressionOf(current));

    if (!isMemberAccess(callee)) return undefined;

    const name = memberName(callee);

    if (name === "route" && isRouter(ast.expressionOf(callee))) {
      const options = current.arguments[1];
      if (options) optionNodes.push(options);

      return { path: pathText(current.arguments[0]), optionNodes };
    }

    if (name === "nest") {
      const options = current.arguments[1];
      if (options) optionNodes.push(options);
    }

    current = unwrap(ast.expressionOf(callee));
  }

  return undefined;
}

function resourceIsReadOnly(node: ast.Node | undefined): boolean {
  if (!node) return false;

  const value = unwrap(node);

  if (!ast.isObjectLiteralExpression(value)) return false;

  for (const property of value.properties) {
    if (!ast.isPropertyAssignment(property) || keyName(property.key) !== "only") continue;

    const only = unwrap(property.value);

    if (!ast.isArrayLiteralExpression(only)) return false;

    return only.elements.every((element) => {
      if (!element) return false;
      const method = literalString(element);
      return method !== undefined && READ_ONLY_RESOURCE_METHODS.has(method);
    });
  }

  return false;
}

function unguardedRoute(node: ast.Node, route: string): SourceFinding {
  return {
    code: "WL9006",
    node,
    message: `Mutating route \`${route}\` has no auth middleware. Add an auth guard (\`middleware: [authMiddleware()]\`, or register it inside a guarded group) or mark it intentionally open with \`public: true\`.`,
  };
}

function checkRouteGuard(node: ast.Node, findings: SourceFinding[]): void {
  if (!ast.isCallExpression(node)) return;

  const callee = unwrap(ast.expressionOf(node));

  if (!isMemberAccess(callee)) return;

  const method = memberName(callee);

  if (!method) return;

  const guarded = (options: ast.Node | undefined) =>
    optionsGuard(options) === "guarded" || insideGuardedGroup(node);

  if (isRouter(ast.expressionOf(callee))) {
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

  const chain = builderChain(ast.expressionOf(callee));

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

function isClientSource(node: ast.Node): boolean {
  if (ast.isCallExpression(node)) {
    const name = calleeName(node);
    if (name !== undefined && CLIENT_INPUT_CALLS.has(name)) return true;
  }

  if (isMemberAccess(node)) {
    const root = rootIdentifier(node);

    if (root && CLIENT_INPUT_NAMES.has(ast.valueText(root))) return true;

    // location.search / window.location.hash
    const name = memberName(node);

    if (name === "search" || name === "hash") {
      const object = unwrap(ast.expressionOf(node));

      if (ast.isIdentifier(object) && ast.valueText(object) === "location") return true;
      if (isMemberAccess(object) && memberName(object) === "location") return true;
    }
  }

  return false;
}

function isRedirectTainted(node: ast.Node): boolean {
  return containsRequestInput(node, { sanitizers: REDIRECT_SANITIZERS, isSource: isClientSource });
}

/** An enclosing `if (isSafeRedirect(x))` or `isSafeRedirect(x) ? … : …` validated the target. */
function checkedByValidator(node: ast.Node): boolean {
  for (const ancestor of ancestors(node)) {
    let test: ast.Node | undefined;

    if (ast.isIfStatement(ancestor)) test = ast.expressionOf(ancestor);
    else if (ast.isConditionalExpression(ancestor)) test = ancestor.test;
    else continue;

    let validated = false;

    walk(test, (child) => {
      if (ast.isCallExpression(child)) {
        const name = calleeName(child);
        if (name !== undefined && REDIRECT_VALIDATORS.has(name)) validated = true;
      }

      return undefined;
    });

    if (validated) return true;
  }

  return false;
}

function unsafeRedirect(node: ast.Node, what: string, helper: string, from: string): SourceFinding {
  return {
    code: "WL9007",
    node,
    message: `This ${what} target comes from request input. Pass it through \`${helper}()\` from \`${from}\` so only same-origin paths and allow-listed origins are followed (open redirects and \`javascript:\` URLs otherwise).`,
  };
}

function checkRedirect(node: ast.Node, findings: SourceFinding[]): void {
  if (ast.isCallExpression(node)) {
    const name = calleeName(node);

    if (name === undefined || !REDIRECT_CALLS.has(name)) return;

    // `router.redirect(from, to)` registers a static redirect, not a request-time one.
    const callee = unwrap(ast.expressionOf(node));

    if (isMemberAccess(callee)) {
      const owner = unwrap(ast.expressionOf(callee));
      if (ast.isIdentifier(owner) && ast.valueText(owner) === "router") return;
    }

    const target = node.arguments[0];

    if (!target || ast.isSpreadElement(target)) return;
    if (!isRedirectTainted(target) || checkedByValidator(node)) return;

    findings.push(
      name === "navigateTo"
        ? unsafeRedirect(target, "navigation", "safeRedirectTarget", "@warlock.js/web")
        : unsafeRedirect(target, "redirect", "safeRedirect", "@warlock.js/core"),
    );

    return;
  }

  if (!ast.isJsxAttribute(node) || ast.nameNode(node).type !== "JSXIdentifier") return;
  if (ast.valueText(ast.nameNode(node)) !== "to" && ast.valueText(ast.nameNode(node)) !== "href")
    return;

  const element = ast.parentOf(node);

  if (!element || (!ast.isJsxOpeningElement(element) && !ast.isJsxSelfClosingElement(element)))
    return;
  if (element.name.type !== "JSXIdentifier" || !LINK_COMPONENTS.has(element.name.name)) return;

  const initializer = node.value;

  if (!initializer || !ast.isJsxExpression(initializer) || !initializer.expression) return;

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
function isWholeAccess(node: ast.Node, member: string): boolean {
  if (ast.isCallExpression(node)) {
    const callee = unwrap(ast.expressionOf(node));
    return isMemberAccess(callee) && memberName(callee) === member;
  }

  return isMemberAccess(node) && memberName(node) === member;
}

type LogFinding = { node: ast.Node; what: string };

function inspectLogged(node: ast.Node, censoredKey: boolean, found: LogFinding[]): void {
  const value = unwrap(node);

  if (isFunctionLike(value)) return;

  if (ast.isCallExpression(value)) {
    const name = calleeName(value);
    if (name !== undefined && REDACTORS.has(name)) return;
  }

  // request.all() / request.body / request.headers / request.input("email")
  if (ast.isCallExpression(value) || isMemberAccess(value)) {
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

    if (ast.isCallExpression(value) && member !== undefined) {
      const key = literalString(value.arguments[0]);
      const category = key ? sensitiveCategory(key) : undefined;

      if (category && !(censoredKey && category === "secret")) {
        found.push({ node: value, what: describeCategory(category, key) });
        return;
      }
    }
  }

  if (ast.isIdentifier(value) || isMemberAccess(value)) {
    const name = ast.isIdentifier(value) ? ast.valueText(value) : memberName(value);
    const category = name ? sensitiveCategory(name) : undefined;

    if (category && !(censoredKey && category === "secret")) {
      found.push({ node: value, what: describeCategory(category, name) });
      return;
    }

    // `request.body.title` reads one field; only the whole body is reported.
    if (isMemberAccess(value) && requestMemberAccess(value) === undefined) {
      inspectLogged(ast.expressionOf(value), false, found);

      if (ast.isElementAccessExpression(value)) inspectLogged(value.property, false, found);
    }

    return;
  }

  if (ast.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (ast.isSpreadAssignment(property)) {
        inspectLogged(ast.expressionOf(property), false, found);
      } else if (ast.isPropertyAssignment(property)) {
        const key = keyName(property.key);
        inspectLogged(property.value, key !== undefined && isCensoredKey(key), found);
      } else if (ast.isShorthandPropertyAssignment(property)) {
        inspectLogged(property.key, isCensoredKey(ast.valueText(property.key)), found);
      }
    }

    return;
  }

  if (ast.isTemplateExpression(value)) {
    for (const expression of value.expressions) inspectLogged(expression, false, found);
    return;
  }

  if (ast.isBinaryExpression(value)) {
    inspectLogged(value.left, false, found);
    inspectLogged(value.right, false, found);
    return;
  }

  if (ast.isConditionalExpression(value)) {
    inspectLogged(value.consequent, censoredKey, found);
    inspectLogged(value.alternate, censoredKey, found);
    return;
  }

  if (ast.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      if (ast.isOmittedExpression(element)) continue;
      inspectLogged(
        ast.isSpreadElement(element) ? ast.expressionOf(element) : element,
        false,
        found,
      );
    }

    return;
  }

  if (ast.isCallExpression(value)) {
    // JSON.stringify(request.all()), String(user.email), user.email.trim()
    const callee = unwrap(ast.expressionOf(value));

    if (isMemberAccess(callee)) inspectLogged(ast.expressionOf(callee), false, found);

    for (const argument of value.arguments) {
      inspectLogged(
        ast.isSpreadElement(argument) ? ast.expressionOf(argument) : argument,
        false,
        found,
      );
    }

    return;
  }

  if (ast.isAwaitExpression(value)) inspectLogged(ast.expressionOf(value), censoredKey, found);
}

function checkSensitiveLog(node: ast.Node, findings: SourceFinding[]): void {
  if (!ast.isCallExpression(node)) return;

  const callee = unwrap(ast.expressionOf(node));

  if (!isMemberAccess(callee)) return;

  const method = memberName(callee);

  if (!method || !LOG_METHODS.has(method)) return;

  const owner = unwrap(ast.expressionOf(callee));

  if (!ast.isIdentifier(owner)) return;

  // log.info(…), console.log(…), and request.log(…)
  const isLogger =
    LOGGER_NAMES.has(ast.valueText(owner)) ||
    (REQUEST_NAMES.has(ast.valueText(owner)) && method === "log");

  if (!isLogger) return;

  const found: LogFinding[] = [];

  for (const argument of node.arguments) {
    inspectLogged(
      ast.isSpreadElement(argument) ? ast.expressionOf(argument) : argument,
      false,
      found,
    );
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
function regexSource(node: ast.Node | undefined, depth = 0): string | undefined {
  if (!node || depth > 8) return undefined;

  const value = unwrap(node);

  if (ast.isRegularExpressionLiteral(value)) {
    return ast.valueText(value).slice(1, ast.valueText(value).lastIndexOf("/"));
  }

  if (
    (ast.isNewExpression(value) || ast.isCallExpression(value)) &&
    ast.isIdentifier(ast.expressionOf(value)) &&
    ast.valueText(ast.expressionOf(value)) === "RegExp"
  ) {
    return literalString(value.arguments?.[0]);
  }

  if (ast.isIdentifier(value)) {
    const initializer = resolveInitializer(value);
    return initializer ? regexSource(initializer, depth + 1) : undefined;
  }

  return undefined;
}

function checkUnboundedRegex(node: ast.Node, findings: SourceFinding[]): void {
  if (!ast.isCallExpression(node)) return;

  const callee = unwrap(ast.expressionOf(node));

  if (!isMemberAccess(callee)) return;

  const method = memberName(callee);

  if (!method) return;

  const first = node.arguments[0];
  const firstArgument = first && !ast.isSpreadElement(first) ? first : undefined;
  let regex: ast.Node | undefined;
  let input: ast.Node | undefined;

  if (REGEX_METHODS.has(method)) {
    regex = ast.expressionOf(callee);
    input = firstArgument;
  } else if (STRING_METHODS.has(method)) {
    regex = firstArgument;
    input = ast.expressionOf(callee);
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
export function securityFindings(sourceFile: ast.SourceFile): SourceFinding[] {
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
