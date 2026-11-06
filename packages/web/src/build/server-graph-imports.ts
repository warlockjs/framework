/**
 * The rule that keeps the production server bundle compilable: pages are
 * compiled into it, and it takes plain code imports only. The production build
 * fails on a violation; `warlock dev` and `warlock check` warn about the same
 * imports earlier, using the same detector and the same advice.
 */
import { parse } from "@babel/parser";

export const SERVER_GRAPH_IMPORT_REMEDY =
  "move the static file into the application's public/ directory and reference " +
  "it by its root URL instead (for example, public/logo.svg becomes /logo.svg). " +
  "The production server build does not compile static-asset imports, ?raw/?url/?worker " +
  "queries, or import.meta.url in the page graph in 5.2";

const ASSET_EXTENSIONS = [
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
];


const FROM_SPECIFIER = /\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Blank every comment, preserving byte offsets.
 *
 * The scan below is regex over source text, so without this a specifier written
 * inside a comment is indistinguishable from a real import. That is not
 * hypothetical: documenting this very restriction — writing `import "./app.css"`
 * in a doc comment to explain why it is unsupported — failed the build, and the
 * error then insisted the file imported a stylesheet that it did not import.
 * Removing the real import did not help, because the comment was the match.
 *
 * Comments are replaced with spaces rather than deleted so every subsequent
 * offset, and therefore every line number in anything reported from here,
 * stays exactly where it was.
 *
 * A parse failure is deliberately NOT fatal: this function's job is to find
 * hazards, not to validate syntax. esbuild reports a genuine syntax error far
 * better than we would, and failing here would replace its clear message with a
 * worse one. On a parse failure the raw source is scanned — the pre-existing
 * behaviour, false positives and all.
 */
export function withoutComments(source: string): string {
  try {
    const ast = parse(source, {
      sourceType: "module",
      errorRecovery: true,
      plugins: ["typescript", "jsx", "decorators-legacy"],
    });

    let stripped = source;

    for (const comment of ast.comments ?? []) {
      const { start, end } = comment as { start: number; end: number };

      stripped = stripped.slice(0, start) + " ".repeat(end - start) + stripped.slice(end);
    }

    return stripped;
  } catch {
    return source;
  }
}

/** Expects source whose comments have already been blanked by {@link withoutComments}. */
export function collectSpecifiers(source: string): string[] {
  const specifiers: string[] = [];

  for (const pattern of [FROM_SPECIFIER, BARE_IMPORT, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0;

    let match = pattern.exec(source);

    while (match !== null) {
      const specifier = match[1];

      if (specifier !== undefined) specifiers.push(specifier);

      match = pattern.exec(source);
    }
  }

  return specifiers;
}

export function hazardFor(specifier: string): string | undefined {
  const [base = "", query] = specifier.split("?", 2);
  const lowered = base.toLowerCase();

  /*
    STYLESHEETS ARE NOT A HAZARD — see `loader` in WEB_ESBUILD_PATCH above.

    They used to be rejected here, which meant `import "./app.css"` in
    `root.tsx` — the ordinary way to wire Tailwind or any other CSS pipeline —
    failed the build outright. The server bundle now compiles them to nothing,
    because the server only ever needs a stylesheet's URL, and the client bundle
    that Vite builds from the same sources emits the real asset.

    STYLE_EXTENSIONS is still the single list both halves read from, so the set
    esbuild stubs and the set this check tolerates cannot drift apart.
  */

  if (ASSET_EXTENSIONS.some((extension) => lowered.endsWith(extension))) {
    return "imports a static asset";
  }

  if (query !== undefined && /(^|&)(raw|url|worker)(&|=|$)/.test(query)) {
    return "uses a bundler-specific import query";
  }

  return undefined;
}

/** Every server-bundle import hazard found in one source file, in source order. */
export function serverGraphImportHazards(
  source: string,
): { specifier: string; reason: string }[] {
  const found: { specifier: string; reason: string }[] = [];

  for (const specifier of collectSpecifiers(withoutComments(source))) {
    const reason = hazardFor(specifier);

    if (reason !== undefined) found.push({ specifier, reason });
  }

  return found;
}
