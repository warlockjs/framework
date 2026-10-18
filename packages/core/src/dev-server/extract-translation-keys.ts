import * as ast from "../tooling/syntax/ast";

/**
 * Extract literal lookup keys registered through `groupedTranslations` calls,
 * statically, without executing the source.
 *
 * Handles both call shapes:
 * - Named-group: `groupedTranslations("site", { home: { en, ar } })`
 * - Object: `groupedTranslations({ site: { home: { en, ar } } })`
 *
 * Groups nest to any depth (`{ detail: { title: { en, ar } } }` yields
 * `products.detail.title`) — an object is a leaf once none of its own
 * properties hold a further object literal.
 *
 * A dynamic group name, dictionary, or property key (an identifier, spread,
 * or computed name instead of a literal) cannot be resolved statically and is
 * silently skipped; such keys must be documented by the app author instead.
 */
export function extractTranslationKeys(sourceFile: ast.SourceFile): string[] {
  const keys = new Set<string>();

  const visit = (node: ast.Node): void => {
    if (isGroupedTranslationsCall(node)) {
      collectFromCall(node, keys);
    }

    ast.forEachChild(node, visit);
  };

  ast.forEachChild(sourceFile, visit);

  return Array.from(keys).sort();
}

function isGroupedTranslationsCall(node: ast.Node): node is ast.CallExpression {
  return (
    ast.isCallExpression(node) &&
    ast.isIdentifier(ast.expressionOf(node)) &&
    ast.valueText(ast.expressionOf(node)) === "groupedTranslations"
  );
}

function collectFromCall(call: ast.CallExpression, keys: Set<string>): void {
  const [first, second] = call.arguments;

  if (first === undefined) return;

  if (second !== undefined) {
    if (ast.isStringLiteral(first) && ast.isObjectLiteralExpression(second)) {
      collectLeaves(second, ast.valueText(first), keys);
    }
    return;
  }

  if (ast.isObjectLiteralExpression(first)) {
    for (const property of first.properties) {
      if (!ast.isPropertyAssignment(property)) continue;

      const groupName = getPropertyName(property.key);
      if (groupName === undefined) continue;

      if (ast.isObjectLiteralExpression(property.value)) {
        collectLeaves(property.value, groupName, keys);
      }
    }
  }
}

function collectLeaves(object: ast.ObjectExpression, prefix: string, keys: Set<string>): void {
  for (const property of object.properties) {
    if (!ast.isPropertyAssignment(property)) continue;

    const key = getPropertyName(property.key);
    if (key === undefined) continue;

    if (!ast.isObjectLiteralExpression(property.value)) continue;

    const path = `${prefix}.${key}`;

    if (isLeaf(property.value)) {
      keys.add(path);
    } else {
      collectLeaves(property.value, path, keys);
    }
  }
}

/** A locale map (`{ en: "...", ar: "..." }`) has no object-literal children. */
function isLeaf(object: ast.ObjectExpression): boolean {
  return !object.properties.some(
    (property) =>
      ast.isPropertyAssignment(property) && ast.isObjectLiteralExpression(property.value),
  );
}

function getPropertyName(name: ast.Node | undefined): string | undefined {
  return ast.keyName(name);
}
