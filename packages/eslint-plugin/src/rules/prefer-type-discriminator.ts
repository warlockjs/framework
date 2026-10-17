import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { docsUrl } from "../utils/ast";

type TsNode = { type: string; [key: string]: unknown };

type PropertySignature = TsNode & {
  key: ESTree.Node;
  computed?: boolean;
  typeAnnotation?: { typeAnnotation?: TsNode } | null;
};

/**
 * Warlock names the tag of a discriminated union `type`, never `kind`, so
 * every union in an app narrows the same way (`switch (value.type)`).
 */
export const preferTypeDiscriminator: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Use `type`, not `kind`, as the discriminator of a union",
      recommended: false,
      url: docsUrl("prefer-type-discriminator"),
    },
    schema: [],
    messages: {
      kind: "Name this discriminator `type`, not `kind` (the framework's convention for tagged unions).",
    },
  },

  create(context) {
    return {
      TSPropertySignature(listenerNode: ESTree.Node) {
        const node = listenerNode as unknown as PropertySignature;
        if (node.computed) return;
        const key = node.key;
        const name =
          key.type === "Identifier"
            ? key.name
            : key.type === "Literal" && typeof key.value === "string"
              ? key.value
              : undefined;
        if (name !== "kind") return;
        if (!isLiteralType(node.typeAnnotation?.typeAnnotation)) return;

        context.report({ node: key, messageId: "kind" });
      },
    } as Rule.RuleListener;
  },
};

/** A string/number literal type, or a union made only of them. */
function isLiteralType(node: TsNode | undefined): boolean {
  if (!node) return false;
  if (node.type === "TSLiteralType") return true;
  if (node.type === "TSUnionType" && Array.isArray(node.types)) {
    return (node.types as TsNode[]).every((member) => member.type === "TSLiteralType");
  }
  return false;
}
