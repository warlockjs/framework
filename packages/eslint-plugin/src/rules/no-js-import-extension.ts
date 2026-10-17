import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { docsUrl } from "../utils/ast";

const JS_EXTENSION = /\.jsx?$/;

/**
 * Warlock apps resolve relative imports without extensions (`./user.model`);
 * a `.js` suffix on a TypeScript import points at a file that does not exist
 * in the source tree and breaks the dev server's module graph.
 */
export const noJsImportExtension: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow `.js` extensions in relative import paths",
      recommended: true,
      url: docsUrl("no-js-import-extension"),
    },
    fixable: "code",
    schema: [],
    messages: {
      extension:
        "Drop the `{{extension}}` extension from `{{specifier}}`; Warlock resolves relative imports without it.",
    },
  },

  create(context) {
    const check = (source: ESTree.Node | null | undefined) => {
      if (!source || source.type !== "Literal" || typeof source.value !== "string") return;
      const specifier = source.value;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return;
      const extension = JS_EXTENSION.exec(specifier)?.[0];
      if (!extension) return;

      const raw = source.raw ?? JSON.stringify(specifier);
      const quote = raw[0] === "'" ? "'" : '"';
      const fixed = specifier.slice(0, -extension.length);

      context.report({
        node: source,
        messageId: "extension",
        data: { extension, specifier },
        fix: (fixer) => fixer.replaceText(source, `${quote}${fixed}${quote}`),
      });
    };

    return {
      ImportDeclaration: (node) => check((node as ESTree.ImportDeclaration).source),
      ExportNamedDeclaration: (node) => check((node as ESTree.ExportNamedDeclaration).source),
      ExportAllDeclaration: (node) => check((node as ESTree.ExportAllDeclaration).source),
      ImportExpression: (node) => check((node as ESTree.ImportExpression).source),
    };
  },
};
