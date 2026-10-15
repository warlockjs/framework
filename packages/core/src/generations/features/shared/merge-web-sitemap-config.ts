import ts from "typescript";

/** What {@link mergeWebSitemapConfig} did, or could not do, to the source it was given. */
export type WebSitemapMergeResult =
  { status: "merged"; next: string } | { status: "already-present" } | { status: "unrecognised" };

/**
 * Merge a disabled `sitemap` section into `src/config/web.ts` SOURCE TEXT.
 *
 * **String surgery, never parse-and-print** — same rationale as
 * `insertConnectorEntry`: `web.ts` is app-owned and may carry any formatting
 * or comments a parse-and-print would discard. The TypeScript AST is used to
 * *find where to cut*, never to regenerate the file — the splice below still
 * copies the original source's bytes verbatim.
 *
 * Recognises the exported config object two ways: an inline `export default
 * {...}`, or `export default <identifier>;` pointing back at a `const
 * <identifier> = {...}` (or `const <identifier>: SomeType = {...}`) declared
 * earlier in the file — the shape this generator itself scaffolds, and the
 * shape every other generated config file in this project uses. Any other
 * shape (a function call, a re-export, no default export at all) returns
 * `"unrecognised"` rather than guessing at where to cut — clobbering an
 * app-owned file the merge could not actually understand is worse than
 * refusing.
 *
 * A `sitemap` property already present anywhere in the source (by key, so one
 * a human has since hand-edited is still found) is left unchanged — that is
 * what makes a second `warlock add sitemap` a no-op instead of a duplicate
 * block. Detection walks the AST rather than regex-matching `sitemap\s*:`, so
 * a comment like `// sitemap: TODO` — text, not a property — does not count.
 *
 * Before returning a merge, the resulting text is re-parsed and checked for
 * syntax errors; a merge that would not itself parse is refused (as
 * `"unrecognised"`) instead of written, since a matched-but-corrupt splice is
 * worse than doing nothing.
 *
 * @param source The config file's current text.
 * @returns What happened, and the new text when there is any.
 */
export function mergeWebSitemapConfig(source: string): WebSitemapMergeResult {
  const sourceFile = ts.createSourceFile(
    "web.ts",
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const objectLiteral = findExportedConfigObjectLiteral(sourceFile);

  if (!objectLiteral) {
    return { status: "unrecognised" };
  }

  if (hasTopLevelSitemapProperty(objectLiteral)) {
    return { status: "already-present" };
  }

  const bodyStart = objectLiteral.getStart(sourceFile) + 1;
  const closingBraceIndex = objectLiteral.getEnd() - 1;
  const body = source.slice(bodyStart, closingBraceIndex);

  const indentMatch = /\n([ \t]*)\S/.exec(body);
  const indent = indentMatch ? indentMatch[1] : "  ";

  const block =
    `${indent}sitemap: {\n` +
    `${indent}${indent}enabled: false,\n` +
    `${indent}${indent}path: "/sitemap.xml",\n` +
    `${indent}${indent}defaults: { changefreq: "weekly", priority: 0.5 },\n` +
    `${indent}},\n`;

  const { index: insertionPoint, needsComma } = lastPropertyEnd(source, closingBraceIndex);

  const next =
    `${source.slice(0, insertionPoint)}` +
    `${needsComma ? ",\n" : ""}` +
    `${block}` +
    `${source.slice(closingBraceIndex)}`;

  if (hasSyntaxErrors(next)) {
    return { status: "unrecognised" };
  }

  return { status: "merged", next };
}

/** Whether TEXT fails to parse as TypeScript source. */
function hasSyntaxErrors(text: string): boolean {
  const { diagnostics } = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    reportDiagnostics: true,
  });

  return Boolean(diagnostics && diagnostics.length > 0);
}

/**
 * Whether the exported config object literal already has a `sitemap`
 * property directly on it — a `sitemap` key nested under some other
 * property (e.g. `seo: { sitemap: true }`) is a different feature's field
 * and must not block adding the top-level one.
 */
function hasTopLevelSitemapProperty(objectLiteral: ts.ObjectLiteralExpression): boolean {
  return objectLiteral.properties.some(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyKeyName(property.name) === "sitemap",
  );
}

/** The literal text of a property name node, when it is one of the plain shapes we care about. */
function propertyKeyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

/**
 * Find the object literal a source file's default export ultimately points
 * at, whether the export is inline or an identifier declared earlier in the
 * file.
 */
function findExportedConfigObjectLiteral(
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  const exportAssignment = sourceFile.statements.find(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );

  if (!exportAssignment) return undefined;

  const { expression } = exportAssignment;

  if (ts.isObjectLiteralExpression(expression)) {
    return expression;
  }

  if (!ts.isIdentifier(expression)) return undefined;

  const identifier = expression.text;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === identifier &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        return declaration.initializer;
      }
    }
  }

  return undefined;
}

/**
 * Where to insert a new property right before a closing brace, and whether
 * the property immediately before it (if any) needs a trailing comma added —
 * an object literal with two properties and no comma between them does not
 * parse.
 */
function lastPropertyEnd(
  source: string,
  closingBraceIndex: number,
): { index: number; needsComma: boolean } {
  let cursor = closingBraceIndex - 1;

  while (cursor >= 0 && /\s/.test(source.charAt(cursor))) {
    cursor--;
  }

  if (cursor < 0 || source[cursor] === "{" || source[cursor] === ",") {
    return { index: closingBraceIndex, needsComma: false };
  }

  return { index: cursor + 1, needsComma: true };
}
