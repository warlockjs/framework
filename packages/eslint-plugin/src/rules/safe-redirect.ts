import type { Rule } from "eslint";
import type * as ESTree from "estree";
import {
  ancestors,
  asNode,
  calleeName,
  docsUrl,
  propertyName,
  rootIdentifier,
  unwrapExpression,
  walk,
  type AnyNode,
} from "../utils/ast";
import { ensureNamedImport } from "../utils/imports";
import { containsRequestInput, requestNames } from "../utils/request-input";

/** Calls that turn their first argument into a redirect or a navigation. */
const DEFAULT_REDIRECT_CALLS = ["redirect", "permanentRedirect", "navigateTo"];

/** Components whose `to`/`href` prop navigates. */
const DEFAULT_LINK_COMPONENTS = ["Link", "NavLink"];

/** Helpers that return an allowed target (or a fallback) for any input. */
const DEFAULT_SANITIZERS = ["safeRedirect", "safeRedirectTarget"];

/** Predicates that, used in an enclosing `if`, prove the target was checked. */
const DEFAULT_VALIDATORS = ["isSafeRedirect", "isSafeRedirectUrl"];

/** Client-side input: query-string hooks. */
const CLIENT_INPUT_CALLS: ReadonlySet<string> = new Set([
  "useQueryString",
  "useSearchParams",
  "useParams",
]);

/** Identifiers whose members are client-controlled (loader `query`, URLSearchParams). */
const DEFAULT_INPUT_NAMES = ["query", "searchParams"];

export type SafeRedirectOptions = {
  requestNames?: string[];
  redirectCalls?: string[];
  linkComponents?: string[];
  sanitizers?: string[];
  validators?: string[];
  inputNames?: string[];
};

/**
 * A redirect target taken from request input is an open redirect, and a
 * `javascript:` one runs script. Pass it through `safeRedirect()` (server, from
 * `@warlock.js/core`) or `safeRedirectTarget()` (pages, from `@warlock.js/web`),
 * which only let same-origin paths and allow-listed origins through.
 */
export const safeRedirect: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the redirect allowlist helper when a redirect or `<Link to>` target comes from request input",
      recommended: true,
      url: docsUrl("safe-redirect"),
    },
    hasSuggestions: true,
    schema: [
      {
        type: "object",
        properties: {
          requestNames: { type: "array", items: { type: "string" } },
          redirectCalls: { type: "array", items: { type: "string" } },
          linkComponents: { type: "array", items: { type: "string" } },
          sanitizers: { type: "array", items: { type: "string" } },
          validators: { type: "array", items: { type: "string" } },
          inputNames: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      redirect:
        "This {{what}} target comes from request input. Pass it through `{{helper}}()` so only same-origin paths and allow-listed origins are followed (open redirects and `javascript:` URLs otherwise).",
      wrap: "Wrap the target in `{{helper}}()`.",
    },
  },

  create(context) {
    const options = (context.options[0] ?? {}) as SafeRedirectOptions;
    const names = requestNames(options);
    const redirectCalls = new Set(options.redirectCalls ?? DEFAULT_REDIRECT_CALLS);
    const linkComponents = new Set(options.linkComponents ?? DEFAULT_LINK_COMPONENTS);
    const sanitizers = new Set(options.sanitizers ?? DEFAULT_SANITIZERS);
    const validators = new Set(options.validators ?? DEFAULT_VALIDATORS);
    const inputNames = new Set(options.inputNames ?? DEFAULT_INPUT_NAMES);
    const sourceCode = context.sourceCode;

    const isClientSource = (node: ESTree.Node): boolean => {
      if (node.type === "CallExpression") {
        const name = calleeName(node);
        if (name !== undefined && CLIENT_INPUT_CALLS.has(name)) return true;
      }
      if (node.type === "MemberExpression") {
        const root = rootIdentifier(node);
        if (root && inputNames.has(root.name)) return true;
        // location.search / window.location.hash
        const name = propertyName(node);
        if (name === "search" || name === "hash") {
          const object = unwrapExpression(node.object);
          if (object.type === "Identifier" && object.name === "location") return true;
          if (object.type === "MemberExpression" && propertyName(object) === "location") {
            return true;
          }
        }
      }
      return false;
    };

    const tainted = (node: ESTree.Node) =>
      containsRequestInput(context, node, names, { sanitizers, isSource: isClientSource });

    /** An enclosing `if (isSafeRedirect(x))` / `cond ? … : …` validated the target. */
    const checkedByValidator = (node: AnyNode): boolean => {
      for (const ancestor of ancestors(node)) {
        if (ancestor.type !== "IfStatement" && ancestor.type !== "ConditionalExpression") {
          continue;
        }
        let validated = false;
        walk(ancestor.test, (child) => {
          if (child.type === "CallExpression") {
            const name = calleeName(child);
            if (name !== undefined && validators.has(name)) validated = true;
          }
        });
        if (validated) return true;
      }
      return false;
    };

    const reportTarget = (
      target: ESTree.Node,
      what: string,
      helper: string,
      source: string,
      fallback: string,
    ) => {
      context.report({
        node: target,
        messageId: "redirect",
        data: { what, helper },
        suggest: [
          {
            messageId: "wrap",
            data: { helper },
            fix: (fixer) => [
              fixer.replaceText(target, `${helper}(${sourceCode.getText(target)})${fallback}`),
              ...ensureNamedImport(fixer, sourceCode, source, helper),
            ],
          },
        ],
      });
    };

    return {
      CallExpression(listenerNode) {
        const call = asNode(listenerNode) as ESTree.CallExpression & AnyNode;
        const name = calleeName(call);
        if (name === undefined || !redirectCalls.has(name)) return;

        // `router.redirect(from, to)` registers a static redirect, not a request-time one.
        const callee = unwrapExpression(call.callee);
        if (callee.type === "MemberExpression") {
          const owner = unwrapExpression(callee.object);
          if (owner.type === "Identifier" && owner.name === "router") return;
        }

        const target = call.arguments[0];
        if (!target || target.type === "SpreadElement") return;
        if (!tainted(target) || checkedByValidator(call)) return;

        const clientSide = name === "navigateTo";
        reportTarget(
          target,
          clientSide ? "navigation" : "redirect",
          clientSide ? "safeRedirectTarget" : "safeRedirect",
          clientSide ? "@warlock.js/web" : "@warlock.js/core",
          clientSide ? ' ?? "/"' : "",
        );
      },

      JSXAttribute(listenerNode: ESTree.Node) {
        const attribute = listenerNode as unknown as JsxAttributeNode;
        if (attribute.name.type !== "JSXIdentifier") return;
        if (attribute.name.name !== "to" && attribute.name.name !== "href") return;

        const element = attribute.parent;
        if (!element || element.type !== "JSXOpeningElement") return;
        const elementName = element.name?.type === "JSXIdentifier" ? element.name.name : undefined;
        if (!elementName || !linkComponents.has(elementName)) return;

        const value = attribute.value;
        if (!value || value.type !== "JSXExpressionContainer") return;
        const expression = value.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        if (!tainted(expression) || checkedByValidator(expression as AnyNode)) return;

        reportTarget(expression, "link", "safeRedirectTarget", "@warlock.js/web", ' ?? "/"');
      },
    } as Rule.RuleListener;
  },
};

/** The JSX node shapes this rule reads (ESTree core has no JSX types). */
type JsxAttributeNode = {
  type: "JSXAttribute";
  parent?: JsxOpeningElementNode;
  name: { type: string; name: string };
  value: { type: string; expression?: ESTree.Expression | { type: "JSXEmptyExpression" } } | null;
};

type JsxOpeningElementNode = {
  type: string;
  name?: { type: string; name?: string };
};
