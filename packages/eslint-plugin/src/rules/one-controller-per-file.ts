import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { docsUrl } from "../utils/ast";

/** Handler type annotations that mark a constant as a controller. */
const HANDLER_TYPE_PATTERN = /RequestHandler$/;

const CONTROLLER_NAME_PATTERN = /Controller$/;

/**
 * Each controller lives in its own `<name>.controller.ts` file, next to its
 * validation schema. One file per handler keeps diffs, generators and
 * code search predictable for people and coding agents alike.
 */
export const oneControllerPerFile: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce one controller per file",
      recommended: false,
      url: docsUrl("one-controller-per-file"),
    },
    schema: [],
    messages: {
      extra:
        "`{{name}}` is the {{ordinal}} controller in this file (after `{{first}}`). Move it to its own `*.controller.ts` file.",
    },
  },

  create(context) {
    return {
      Program(node) {
        const program = node as ESTree.Program;
        const controllers: ESTree.Identifier[] = [];

        for (const statement of program.body) {
          const declaration =
            statement.type === "ExportNamedDeclaration" ||
            statement.type === "ExportDefaultDeclaration"
              ? statement.declaration
              : statement;
          if (!declaration) continue;
          controllers.push(...controllerIdentifiers(declaration as ESTree.Node));
        }

        const first = controllers[0];
        if (!first) return;

        controllers.slice(1).forEach((identifier, index) => {
          context.report({
            node: identifier,
            messageId: "extra",
            data: { name: identifier.name, ordinal: ordinal(index + 2), first: first.name },
          });
        });
      },
    };
  },
};

function controllerIdentifiers(node: ESTree.Node): ESTree.Identifier[] {
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    return node.id && CONTROLLER_NAME_PATTERN.test(node.id.name) ? [node.id] : [];
  }

  if (node.type !== "VariableDeclaration") return [];

  const found: ESTree.Identifier[] = [];
  for (const declarator of node.declarations) {
    if (declarator.id.type !== "Identifier") continue;
    if (CONTROLLER_NAME_PATTERN.test(declarator.id.name) || hasHandlerType(declarator.id)) {
      found.push(declarator.id);
    }
  }
  return found;
}

type TypedIdentifier = ESTree.Identifier & {
  typeAnnotation?: {
    typeAnnotation?: { type: string; typeName?: { type: string; name?: string } };
  };
};

function hasHandlerType(identifier: ESTree.Identifier): boolean {
  const annotation = (identifier as TypedIdentifier).typeAnnotation?.typeAnnotation;
  if (!annotation || annotation.type !== "TSTypeReference") return false;
  const name = annotation.typeName?.type === "Identifier" ? annotation.typeName.name : undefined;
  return name !== undefined && HANDLER_TYPE_PATTERN.test(name);
}

function ordinal(position: number): string {
  if (position === 2) return "2nd";
  if (position === 3) return "3rd";
  return `${position}th`;
}
