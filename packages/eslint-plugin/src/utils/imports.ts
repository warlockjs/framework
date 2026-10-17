import type { Rule, SourceCode } from "eslint";
import type * as ESTree from "estree";

/**
 * Fixes that make `name` importable from `source`: nothing when it already is,
 * a specifier added to an existing named import, or a new import statement
 * after the last import (or at the top of the file).
 */
export function ensureNamedImport(
  fixer: Rule.RuleFixer,
  sourceCode: SourceCode,
  source: string,
  name: string,
): Rule.Fix[] {
  const program = sourceCode.ast;
  const imports = program.body.filter(
    (statement): statement is ESTree.ImportDeclaration => statement.type === "ImportDeclaration",
  );

  for (const declaration of imports) {
    if (declaration.source.value !== source) continue;
    const named = declaration.specifiers.filter(
      (specifier): specifier is ESTree.ImportSpecifier => specifier.type === "ImportSpecifier",
    );
    if (named.some((specifier) => specifier.local.name === name)) return [];
    if ((declaration as ESTree.ImportDeclaration & { importKind?: string }).importKind === "type") {
      continue;
    }
    const last = named[named.length - 1];
    if (last) return [fixer.insertTextAfter(last, `, ${name}`)];
  }

  const statement = `import { ${name} } from "${source}";\n`;
  const lastImport = imports[imports.length - 1];
  if (lastImport) return [fixer.insertTextAfter(lastImport, `\n${statement.trimEnd()}`)];

  const first = program.body[0];
  return first ? [fixer.insertTextBefore(first, statement)] : [];
}
