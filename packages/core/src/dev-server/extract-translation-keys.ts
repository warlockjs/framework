import ts from "typescript";

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
export function extractTranslationKeys(sourceFile: ts.SourceFile): string[] {
  const keys = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (isGroupedTranslationsCall(node)) {
      collectFromCall(node, keys);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  return Array.from(keys).sort();
}

function isGroupedTranslationsCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "groupedTranslations"
  );
}

function collectFromCall(call: ts.CallExpression, keys: Set<string>): void {
  const [first, second] = call.arguments;

  if (first === undefined) return;

  if (second !== undefined) {
    if (ts.isStringLiteral(first) && ts.isObjectLiteralExpression(second)) {
      collectLeaves(second, first.text, keys);
    }
    return;
  }

  if (ts.isObjectLiteralExpression(first)) {
    for (const property of first.properties) {
      if (!ts.isPropertyAssignment(property)) continue;

      const groupName = getPropertyName(property.name);
      if (groupName === undefined) continue;

      if (ts.isObjectLiteralExpression(property.initializer)) {
        collectLeaves(property.initializer, groupName, keys);
      }
    }
  }
}

function collectLeaves(
  object: ts.ObjectLiteralExpression,
  prefix: string,
  keys: Set<string>,
): void {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;

    const key = getPropertyName(property.name);
    if (key === undefined) continue;

    if (!ts.isObjectLiteralExpression(property.initializer)) continue;

    const path = `${prefix}.${key}`;

    if (isLeaf(property.initializer)) {
      keys.add(path);
    } else {
      collectLeaves(property.initializer, path, keys);
    }
  }
}

/** A locale map (`{ en: "...", ar: "..." }`) has no object-literal children. */
function isLeaf(object: ts.ObjectLiteralExpression): boolean {
  return !object.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer),
  );
}

function getPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}
