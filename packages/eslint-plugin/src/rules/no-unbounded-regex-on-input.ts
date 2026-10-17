import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { asNode, docsUrl, propertyName, resolveInitializer, unwrapExpression } from "../utils/ast";
import {
  containsRequestInput,
  requestNames,
  type RequestNameOptions,
} from "../utils/request-input";

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
 * An unbounded quantifier (`*`, `+`, `{n,}`) applied to client-controlled text
 * lets a long or crafted input make the regex engine backtrack for seconds
 * (ReDoS) and stall the event loop. Bound the repetition (`{1,64}`) or check
 * the input's length before matching.
 */
export const noUnboundedRegexOnInput: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow unbounded regex quantifiers on request input",
      recommended: true,
      url: docsUrl("no-unbounded-regex-on-input"),
    },
    schema: [
      {
        type: "object",
        properties: {
          requestNames: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unbounded:
        "This regex has an unbounded quantifier (`{{quantifier}}`) and runs on request input, so a crafted input can make it backtrack for a long time (ReDoS). Bound the repetition, e.g. `{1,256}`, or cap the input length before matching.",
    },
  },

  create(context) {
    const names = requestNames(context.options[0] as RequestNameOptions | undefined);

    const regexSource = (node: ESTree.Node | undefined): string | undefined => {
      if (!node) return undefined;
      const value = unwrapExpression(node);

      if (value.type === "Literal" && "regex" in value && value.regex) return value.regex.pattern;

      if (
        (value.type === "NewExpression" || value.type === "CallExpression") &&
        value.callee.type === "Identifier" &&
        value.callee.name === "RegExp"
      ) {
        const pattern = value.arguments[0];
        if (pattern && pattern.type === "Literal" && typeof pattern.value === "string") {
          return pattern.value;
        }
        if (pattern && pattern.type === "TemplateLiteral" && pattern.expressions.length === 0) {
          return pattern.quasis[0]?.value.cooked ?? undefined;
        }
        return undefined;
      }

      if (value.type === "Identifier") {
        const init = resolveInitializer(context, value);
        return init && init !== node ? regexSource(init) : undefined;
      }

      return undefined;
    };

    const check = (
      regex: ESTree.Node | undefined,
      input: ESTree.Node | undefined,
      report: ESTree.Node,
    ) => {
      if (!input) return;
      const source = regexSource(regex);
      if (source === undefined) return;
      const quantifier = findUnboundedQuantifier(source);
      if (!quantifier) return;
      if (!containsRequestInput(context, input, names)) return;
      context.report({ node: report, messageId: "unbounded", data: { quantifier } });
    };

    return {
      CallExpression(listenerNode) {
        const call = asNode(listenerNode) as ESTree.CallExpression;
        const callee = unwrapExpression(call.callee);
        if (callee.type !== "MemberExpression") return;
        const method = propertyName(callee);
        if (!method) return;

        const first = call.arguments[0];
        const firstNode = first && first.type !== "SpreadElement" ? first : undefined;

        if (REGEX_METHODS.has(method)) {
          check(callee.object, firstNode, call);
        } else if (STRING_METHODS.has(method)) {
          check(firstNode, callee.object, call);
        }
      },
    };
  },
};

/**
 * The first unbounded quantifier in a regex source (`*`, `+`, `{n,}`), skipping
 * escapes and character classes. Returns `undefined` when every repetition is
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
      // `(?` groups never put a quantifier here; a leading `*`/`+` is a syntax error anyway.
      const lazy = source[index + 1] === "?" ? "?" : "";
      return `${char}${lazy}`;
    }
    if (char === "{") {
      const match = /^\{(\d+),\}/.exec(source.slice(index));
      if (match) return match[0];
    }
  }

  return undefined;
}
