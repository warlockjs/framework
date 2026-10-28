import { forEachChild, parseSourceFile, type Node, type SourceFile } from "./ast";

/**
 * Module references in real syntax, including type-only, dynamic and require
 * references. Pass an already parsed file to skip parsing it again.
 */
export function importSpecifiers(
  fileName: string,
  source: string | SourceFile,
): { specifier: string; node: Node; dynamic: boolean }[] {
  const found: { specifier: string; node: Node; dynamic: boolean }[] = [];
  const visit = (node: Node): void => {
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source
    )
      found.push({ specifier: node.source.value, node: node.source, dynamic: false });
    else if (
      node.type === "ImportExpression" &&
      node.source.type === "Literal" &&
      typeof node.source.value === "string"
    )
      found.push({ specifier: node.source.value, node: node.source, dynamic: true });
    else if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "require"
    ) {
      const argument = node.arguments[0];
      if (argument?.type === "Literal" && typeof argument.value === "string")
        found.push({ specifier: argument.value, node: argument, dynamic: false });
    }
    forEachChild(node, visit);
  };
  visit(typeof source === "string" ? parseSourceFile(fileName, source) : source);
  return found;
}
