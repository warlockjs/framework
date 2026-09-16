import ts from "typescript";

/** Extract literal lookup keys registered through groupedTranslations calls. */
export function extractTranslationKeys(sourceFile: ts.SourceFile): string[] {
  const keys = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "groupedTranslations"
    ) {
      const [groupArgument, dictionaryArgument] = node.arguments;

      if (
        ts.isStringLiteral(groupArgument) &&
        dictionaryArgument &&
        ts.isObjectLiteralExpression(dictionaryArgument)
      ) {
        for (const property of dictionaryArgument.properties) {
          if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
            continue;
          }

          const key = getPropertyName(property.name);
          if (key !== undefined) {
            keys.add(`${groupArgument.text}.${key}`);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  return Array.from(keys).sort();
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
