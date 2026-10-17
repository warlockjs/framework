import type * as TsMorph from "ts-morph";
import type { CodemodContext, ManualFinding, SourceEdit, SourceFile } from "../types";

/** Local names bound to `exported` imported from `moduleName` (`import { log as l }` → `l`). */
export function importedLocalNames(
  sourceFile: SourceFile,
  moduleName: string,
  exported: string,
): Set<string> {
  const names = new Set<string>();

  for (const declaration of sourceFile.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== moduleName) continue;
    for (const specifier of declaration.getNamedImports()) {
      if (specifier.getName() !== exported) continue;
      names.add(specifier.getAliasNode()?.getText() ?? exported);
    }
  }

  return names;
}

/** Whether the file imports anything from `moduleName`. */
export function importsFrom(sourceFile: SourceFile, moduleName: string): boolean {
  return sourceFile
    .getImportDeclarations()
    .some((declaration) => declaration.getModuleSpecifierValue() === moduleName);
}

/** A replacement of a node's text (leading trivia kept). */
export function replaceNode(
  context: CodemodContext,
  node: TsMorph.Node,
  text: string,
  description: string,
): SourceEdit {
  return {
    file: context.relativePath(node.getSourceFile()),
    start: node.getStart(),
    end: node.getEnd(),
    text,
    line: node.getStartLineNumber(),
    description,
  };
}

/**
 * Remove a node; when it sits alone on its line(s), remove those lines too so
 * no blank line is left behind.
 */
export function removeNode(
  context: CodemodContext,
  node: TsMorph.Node,
  description: string,
): SourceEdit {
  const full = node.getSourceFile().getFullText();
  let start = node.getStart();
  let end = node.getEnd();

  let lineStart = start;
  while (lineStart > 0 && (full[lineStart - 1] === " " || full[lineStart - 1] === "\t")) {
    lineStart--;
  }
  let lineEnd = end;
  while (lineEnd < full.length && (full[lineEnd] === " " || full[lineEnd] === "\t")) lineEnd++;

  const startsLine = lineStart === 0 || full[lineStart - 1] === "\n";
  const endsLine = lineEnd === full.length || full[lineEnd] === "\n" || full[lineEnd] === "\r";
  if (startsLine && endsLine) {
    start = lineStart;
    end = full[lineEnd] === "\r" ? lineEnd + 2 : lineEnd + 1;
    end = Math.min(end, full.length);
  }

  return {
    file: context.relativePath(node.getSourceFile()),
    start,
    end,
    text: "",
    line: node.getStartLineNumber(),
    description,
  };
}

export function manualAt(context: CodemodContext, node: TsMorph.Node, hint: string): ManualFinding {
  return {
    file: context.relativePath(node.getSourceFile()),
    line: node.getStartLineNumber(),
    hint,
  };
}

/** The property names of an object literal (static names only). */
export function objectPropertyNames(
  tsMorph: CodemodContext["tsMorph"],
  literal: TsMorph.ObjectLiteralExpression,
): Set<string> {
  const names = new Set<string>();
  for (const property of literal.getProperties()) {
    if (
      tsMorph.Node.isPropertyAssignment(property) ||
      tsMorph.Node.isShorthandPropertyAssignment(property) ||
      tsMorph.Node.isMethodDeclaration(property)
    ) {
      names.add(property.getName().replace(/^["']|["']$/g, ""));
    }
  }
  return names;
}

/** The object literal assigned to `name` in `literal`, if any. */
export function objectProperty(
  tsMorph: CodemodContext["tsMorph"],
  literal: TsMorph.ObjectLiteralExpression,
  name: string,
): TsMorph.Node | undefined {
  for (const property of literal.getProperties()) {
    if (!tsMorph.Node.isPropertyAssignment(property)) continue;
    if (property.getName().replace(/^["']|["']$/g, "") !== name) continue;
    return property.getInitializer();
  }
  return undefined;
}
