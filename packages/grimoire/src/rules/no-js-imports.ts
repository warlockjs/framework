/**
 * GR3010 `no-js-imports`: relative import paths carry no `.js` extension.
 * Flags the specifier of `import … from`, `export … from`, `import()`,
 * `import "x"` and `require()` when it starts with `./` or `../` and ends in
 * `.js`, `.jsx`, `.mjs` or `.cjs`. Package imports are never flagged.
 */
import type { ScannedSource } from "./scan";
import type { RuleHit } from "./types";

const RELATIVE_JS = /^\.\.?\/.*\.(?:js|jsx|mjs|cjs)$/;
const IMPORT_CONTEXT = /(?:\bfrom|\bimport\s*\(?|\brequire\s*\()\s*$/;

/** The hits of the rule. */
export function noJsImports(scanned: ScannedSource): RuleHit[] {
  const hits: RuleHit[] = [];

  for (const part of scanned.strings) {
    if (!RELATIVE_JS.test(part.text)) continue;

    const before = scanned.bare.slice(Math.max(0, part.quoteStart - 40), part.quoteStart);

    if (!IMPORT_CONTEXT.test(before)) continue;

    hits.push({
      line: part.line,
      column: part.column,
      message: `the import ${JSON.stringify(part.text)} ends in a JavaScript extension; drop it`,
    });
  }

  return hits;
}
