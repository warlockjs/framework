import type { Rule } from "eslint";
import type * as ESTree from "estree";
import {
  asNode,
  calleeName,
  docsUrl,
  isFunctionNode,
  objectKeyName,
  propertyName,
  unwrapExpression,
} from "../utils/ast";
import {
  REQUEST_BODY_MEMBERS,
  requestMemberAccess,
  requestNames,
  type RequestNameOptions,
} from "../utils/request-input";

const DEFAULT_LOGGER_NAMES = ["log", "logger", "console"];

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
const DEFAULT_REDACTORS = [
  "maskEmail",
  "maskEmailsInText",
  "redact",
  "redactHeaders",
  "redactError",
  "redactUrlCredentials",
  "redactQueryCredentials",
  "escapeLogValue",
  "toLogSnapshot",
];

/**
 * Keys `@warlock.js/logger` censors by default in structured log data (its
 * `DEFAULT_REDACT_KEYS`, normalized: lower case, no `-`/`_`). A secret logged
 * under one of these keys never reaches a channel, so it is not reported.
 * Emails are deliberately absent: they are not censored by default.
 */
const LOGGER_REDACTED_KEYS: ReadonlySet<string> = new Set(
  [
    "password",
    "passwd",
    "pwd",
    "passphrase",
    "passwordHash",
    "currentPassword",
    "newPassword",
    "passwordConfirmation",
    "secret",
    "clientSecret",
    "appSecret",
    "apiSecret",
    "secretKey",
    "token",
    "accessToken",
    "refreshToken",
    "idToken",
    "authToken",
    "apiToken",
    "bearerToken",
    "csrfToken",
    "sessionToken",
    "resetToken",
    "verificationToken",
    "jwt",
    "otp",
    "apiKey",
    "privateKey",
    "encryptionKey",
    "signingKey",
    "authorization",
    "proxyAuthorization",
    "x-api-key",
    "x-auth-token",
    "cookie",
    "set-cookie",
    "sessionId",
    "credentials",
    "credential",
    "connectionString",
  ].map(normalize),
);

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

export type NoSensitiveLogOptions = RequestNameOptions & {
  loggerNames?: string[];
  redactors?: string[];
};

type Finding = { node: ESTree.Node; what: string };

/**
 * Logs outlive the request and travel to more places than the database does.
 * Raw emails, tokens and whole request bodies must go through the redaction
 * helpers (`maskEmail()`, `redact()`, `request.toLogSnapshot()` …) or be logged
 * under a key the logger censors.
 */
export const noSensitiveLog: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow logging raw emails, tokens and request bodies outside the redaction helpers",
      recommended: true,
      url: docsUrl("no-sensitive-log"),
    },
    schema: [
      {
        type: "object",
        properties: {
          requestNames: { type: "array", items: { type: "string" } },
          loggerNames: { type: "array", items: { type: "string" } },
          redactors: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      sensitive:
        "Do not log {{what}} as-is. Pass it through a redaction helper (`maskEmail()`, `redact()`, `request.toLogSnapshot()`), or log it under a key the logger censors.",
    },
  },

  create(context) {
    const options = (context.options[0] ?? {}) as NoSensitiveLogOptions;
    const names = requestNames(options);
    const loggers = new Set(options.loggerNames ?? DEFAULT_LOGGER_NAMES);
    const redactors = new Set(options.redactors ?? DEFAULT_REDACTORS);

    const inspect = (node: ESTree.Node, censoredKey: boolean, findings: Finding[]): void => {
      const value = unwrapExpression(node);

      if (isFunctionNode(value)) return;

      if (value.type === "CallExpression") {
        const name = calleeName(value);
        if (name !== undefined && redactors.has(name)) return;
      }

      // request.all() / request.body / request.headers
      if (value.type === "CallExpression" || value.type === "MemberExpression") {
        const member = requestMemberAccess(value, names);
        if (member !== undefined && isWholeAccess(value, member)) {
          if (REQUEST_BODY_MEMBERS.has(member)) {
            findings.push({ node: value, what: `the request ${describeMember(member)}` });
            return;
          }
          if (member === "email") {
            findings.push({ node: value, what: "a raw email address" });
            return;
          }
        }
        // request.input("email") / request.get("token")
        if (value.type === "CallExpression" && member !== undefined) {
          const key = stringArgument(value);
          const category = key ? sensitiveCategory(key) : undefined;
          if (category && !(censoredKey && category === "secret")) {
            findings.push({ node: value, what: describeCategory(category, key) });
            return;
          }
        }
      }

      if (value.type === "Identifier" || value.type === "MemberExpression") {
        const name = value.type === "Identifier" ? value.name : propertyName(value);
        const category = name ? sensitiveCategory(name) : undefined;
        if (category && !(censoredKey && category === "secret")) {
          findings.push({ node: value, what: describeCategory(category, name) });
          return;
        }
        // `request.body.title` reads one field; only the whole body is reported.
        if (value.type === "MemberExpression" && requestMemberAccess(value, names) === undefined) {
          inspect(value.object, false, findings);
          if (value.computed) inspect(value.property, false, findings);
        }
        return;
      }

      if (value.type === "ObjectExpression") {
        for (const property of value.properties) {
          if (property.type === "SpreadElement") {
            inspect(property.argument, false, findings);
            continue;
          }
          const key = objectKeyName(property);
          const censored = key !== undefined && LOGGER_REDACTED_KEYS.has(normalize(key));
          inspect(property.value, censored, findings);
        }
        return;
      }

      if (value.type === "TemplateLiteral") {
        for (const expression of value.expressions) inspect(expression, false, findings);
        return;
      }

      if (value.type === "BinaryExpression" || value.type === "LogicalExpression") {
        inspect(value.left, false, findings);
        inspect(value.right, false, findings);
        return;
      }

      if (value.type === "ConditionalExpression") {
        inspect(value.consequent, censoredKey, findings);
        inspect(value.alternate, censoredKey, findings);
        return;
      }

      if (value.type === "ArrayExpression") {
        for (const element of value.elements) {
          if (element)
            inspect(element.type === "SpreadElement" ? element.argument : element, false, findings);
        }
        return;
      }

      if (value.type === "CallExpression") {
        // JSON.stringify(request.all()), String(user.email), user.email.trim()
        const callee = unwrapExpression(value.callee);
        if (callee.type === "MemberExpression") inspect(callee.object, false, findings);
        for (const argument of value.arguments) {
          inspect(
            argument.type === "SpreadElement" ? argument.argument : argument,
            false,
            findings,
          );
        }
        return;
      }

      if (value.type === "AwaitExpression") inspect(value.argument, censoredKey, findings);
    };

    return {
      CallExpression(listenerNode) {
        const call = asNode(listenerNode) as ESTree.CallExpression;
        const callee = unwrapExpression(call.callee);
        if (callee.type !== "MemberExpression") return;
        const method = propertyName(callee);
        if (!method || !LOG_METHODS.has(method)) return;

        const owner = unwrapExpression(callee.object);
        const isLogger =
          (owner.type === "Identifier" && loggers.has(owner.name)) ||
          // request.log("…")
          (owner.type === "Identifier" && names.has(owner.name) && method === "log");
        if (!isLogger) return;

        const findings: Finding[] = [];
        for (const argument of call.arguments) {
          inspect(
            argument.type === "SpreadElement" ? argument.argument : argument,
            false,
            findings,
          );
        }

        for (const finding of findings) {
          context.report({
            node: finding.node,
            messageId: "sensitive",
            data: { what: finding.what },
          });
        }
      },
    };
  },
};

function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, "");
}

/** `email` for addresses, `secret` for credentials, otherwise `undefined`. */
function sensitiveCategory(name: string): "email" | "secret" | undefined {
  const normalized = normalize(name);
  if (
    normalized === "email" ||
    normalized.endsWith("email") ||
    normalized.endsWith("emailaddress")
  ) {
    return "email";
  }
  if (LOGGER_REDACTED_KEYS.has(normalized)) return "secret";
  if (SECRET_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return "secret";
  return undefined;
}

function describeCategory(category: "email" | "secret", name: string | undefined): string {
  if (category === "email") return "a raw email address";
  return name ? `the credential \`${name}\`` : "a credential";
}

function describeMember(member: string): string {
  if (member === "headers") return "headers";
  if (member === "cookies") return "cookies";
  return `body (\`${member}\`)`;
}

/** `request.all()` / `request.body` itself, not `request.body.title`. */
function isWholeAccess(node: ESTree.Node, member: string): boolean {
  if (node.type === "CallExpression") {
    const callee = unwrapExpression(node.callee);
    return callee.type === "MemberExpression" && propertyName(callee) === member;
  }
  return node.type === "MemberExpression" && propertyName(node) === member;
}

function stringArgument(call: ESTree.CallExpression): string | undefined {
  const first = call.arguments[0];
  if (!first || first.type === "SpreadElement") return undefined;
  const value = unwrapExpression(first);
  return value.type === "Literal" && typeof value.value === "string" ? value.value : undefined;
}
