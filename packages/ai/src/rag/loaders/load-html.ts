import type { RagDocument } from "../contracts/rag-document.type";
import type { LoadHtmlOptions, RagLoaderResult } from "./loader.type";

/** Default `id` when the caller supplies none. */
const DEFAULT_ID = "document";

/**
 * Elements whose *content* is not human-readable text and must be removed
 * wholesale (open tag → close tag → everything in between) before tags are
 * stripped. `script` / `style` would otherwise leak code into the chunked
 * text; `noscript` / `template` / `head` / `svg` are non-prose noise.
 */
const STRIPPED_ELEMENTS = ["script", "style", "noscript", "template", "head", "svg"];

/**
 * Block-level tags that imply a line break in the readable text. Replacing
 * them with `\n` BEFORE the generic tag strip keeps paragraph / list / table
 * structure (so the recursive splitter still sees `\n\n` boundaries) instead
 * of collapsing the whole page onto one line.
 */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
  "blockquote",
  "pre",
  "hr",
  "br",
]);

/*
 * The strip passes below are hand-written scans rather than regular
 * expressions. Each one walks the input once and stops at the first
 * opener that can no longer be closed, so markup that never closes
 * (`<!--`, `<script>`, a bare `<`, repeated a million times) costs linear
 * time instead of rescanning the rest of the page from every opener.
 * Tag names compare ASCII case-insensitively, as HTML does.
 */

/** Whether a UTF-16 code unit is an ASCII word character (`[A-Za-z0-9_]`). */
function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

/** ASCII case-insensitive "does `text` contain `needle` at `at`"; `needle` is lower-case. */
function matchesAt(text: string, at: number, needle: string): boolean {
  if (at + needle.length > text.length) {
    return false;
  }

  for (let offset = 0; offset < needle.length; offset++) {
    let code = text.charCodeAt(at + offset);

    if (code >= 65 && code <= 90) {
      code += 32;
    }

    if (code !== needle.charCodeAt(offset)) {
      return false;
    }
  }

  return true;
}

/** First index of `needle` (lower-case, starting with `<`) at or after `from`, ignoring ASCII case. */
function indexOfTag(text: string, needle: string, from: number): number {
  for (let index = text.indexOf("<", from); index !== -1; index = text.indexOf("<", index + 1)) {
    if (matchesAt(text, index, needle)) {
      return index;
    }
  }

  return -1;
}

/** Replace every `<!-- … -->` comment with a space. An unclosed comment is left as text. */
function stripComments(text: string): string {
  const parts: string[] = [];
  let position = 0;

  for (;;) {
    const open = text.indexOf("<!--", position);
    if (open === -1) break;

    const close = text.indexOf("-->", open + 4);
    if (close === -1) break;

    parts.push(text.slice(position, open), " ");
    position = close + 3;
  }

  parts.push(text.slice(position));

  return parts.join("");
}

/**
 * Replace each `<tag …>…</tag>` element (content and all) with a space.
 * The opener needs its `>`; the element ends at the first `</tag>`.
 */
function stripElements(text: string, tag: string): string {
  const opener = `<${tag}`;
  const closer = `</${tag}>`;
  const parts: string[] = [];
  let position = 0;
  let search = 0;

  for (;;) {
    const start = indexOfTag(text, opener, search);
    if (start === -1) break;

    const nameEnd = start + opener.length;
    if (nameEnd < text.length && isWordChar(text.charCodeAt(nameEnd))) {
      // `<scripts>` is a different tag.
      search = start + 1;
      continue;
    }

    const openerEnd = text.indexOf(">", nameEnd);
    if (openerEnd === -1) break;

    const close = indexOfTag(text, closer, openerEnd + 1);
    if (close === -1) break;

    parts.push(text.slice(position, start), " ");
    position = close + closer.length;
    search = position;
  }

  parts.push(text.slice(position));

  return parts.join("");
}

/**
 * Replace each tag whose name passes `accept` (`<name …>` or `</name …>`)
 * with `replacement`. The name is the run of word characters after `<` or
 * `</`; the tag ends at the next `>`.
 */
function replaceNamedTags(
  text: string,
  accept: (name: string) => boolean,
  replacement: string,
): string {
  const parts: string[] = [];
  let position = 0;
  let search = 0;

  for (;;) {
    const start = text.indexOf("<", search);
    if (start === -1) break;

    let nameStart = start + 1;
    if (text.charCodeAt(nameStart) === 47 /* "/" */) {
      nameStart++;
    }

    let nameEnd = nameStart;
    while (nameEnd < text.length && isWordChar(text.charCodeAt(nameEnd))) {
      nameEnd++;
    }

    if (nameEnd === nameStart || !accept(text.slice(nameStart, nameEnd).toLowerCase())) {
      search = start + 1;
      continue;
    }

    const end = text.indexOf(">", nameEnd);
    if (end === -1) break;

    parts.push(text.slice(position, start), replacement);
    position = end + 1;
    search = position;
  }

  parts.push(text.slice(position));

  return parts.join("");
}

/** Remove every remaining `<…>` tag (at least one character between the brackets). */
function stripTags(text: string): string {
  const parts: string[] = [];
  let position = 0;
  let search = 0;

  for (;;) {
    const start = text.indexOf("<", search);
    if (start === -1 || start + 1 >= text.length) break;

    if (text.charCodeAt(start + 1) === 62 /* ">" */) {
      search = start + 1;
      continue;
    }

    const end = text.indexOf(">", start + 2);
    if (end === -1) break;

    parts.push(text.slice(position, start));
    position = end + 1;
    search = position;
  }

  parts.push(text.slice(position));

  return parts.join("");
}

/** Named HTML entities common in prose. Numeric entities are decoded generically. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
};

/**
 * Decode the HTML entities that survive tag stripping: named (`&amp;`),
 * decimal (`&#169;`), and hex (`&#xA9;`). Unknown named entities are left
 * verbatim rather than dropped, so unusual markup never silently loses text.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);

      if (Number.isNaN(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return match;
      }

      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }

    const named = NAMED_ENTITIES[body.toLowerCase()];

    return named ?? match;
  });
}

/**
 * Pull the `<title>` text out of the document, decoded and trimmed, or
 * `undefined` when there is none. Read BEFORE `<head>` is stripped.
 */
function extractTitle(html: string): string | undefined {
  const start = indexOfTag(html, "<title", 0);
  if (start === -1) {
    return undefined;
  }

  const openerEnd = html.indexOf(">", start + "<title".length);
  if (openerEnd === -1) {
    return undefined;
  }

  const close = indexOfTag(html, "</title>", openerEnd + 1);
  if (close === -1) {
    return undefined;
  }

  const title = decodeEntities(html.slice(openerEnd + 1, close))
    .replace(/\s+/g, " ")
    .trim();

  return title.length > 0 ? title : undefined;
}

/**
 * Strip HTML markup down to readable plain text — a lightweight,
 * dependency-free pass (no DOM parser): drop comments and non-prose elements
 * (`script` / `style` / `head` / `svg` / …) content-and-all, convert block
 * tags to line breaks to preserve paragraph structure, remove every
 * remaining tag, decode entities, then collapse runs of whitespace while
 * keeping blank-line paragraph separators.
 */
function htmlToText(html: string): string {
  let text = html;

  // 1. Comments first — a commented-out `<script>` must not survive.
  text = stripComments(text);

  // 2. Non-prose elements, content and all.
  for (const tag of STRIPPED_ELEMENTS) {
    text = stripElements(text, tag);
    // Defensively drop a self-closing / unterminated open tag too.
    text = replaceNamedTags(text, (name) => name === tag, " ");
  }

  // 3. Block tags → newlines, so paragraph / list structure survives.
  text = replaceNamedTags(text, (name) => BLOCK_TAGS.has(name), "\n");

  // 4. Every remaining tag → gone.
  text = stripTags(text);

  // 5. Entities → characters.
  text = decodeEntities(text);

  // 6. Normalize whitespace: trim each line, drop blank runs to a single
  //    blank line (a paragraph separator the recursive splitter honors).
  text = text
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/**
 * Load an HTML string into a single {@link RagDocument} of readable text.
 * Scripts, styles, and other non-prose elements are dropped content-and-all,
 * block tags become line breaks (so paragraph structure survives for the
 * splitter), remaining tags are stripped, and HTML entities are decoded — a
 * lightweight linear scan, no heavy DOM dependency.
 *
 * The document's `metadata.title` is set from the page's `<title>` (unless
 * the caller overrode it), and `metadata.loader` is `"html"`. The output is
 * the exact shape `index()` consumes.
 *
 * @example
 * const kb = ai.rag({ embedder, store });
 * await kb.index(loadHtml(rawHtmlString, { id: "landing-page" }));
 *
 * @param html - The raw HTML markup.
 * @param options - Shared `id` / `metadata` / `tags` ({@link LoadHtmlOptions}).
 * @returns A {@link RagLoaderResult} (one document) ready for `rag.index()`.
 */
export function loadHtml(html: string, options: LoadHtmlOptions = {}): RagLoaderResult {
  const id = options.id ?? DEFAULT_ID;
  const title = extractTitle(html);
  const text = htmlToText(html);

  // An all-markup / empty page strips to nothing; emit no document so
  // index() never receives a no-op record (matches loadText's behavior).
  if (text.length === 0) {
    return [];
  }

  // Derived keys (source, loader, title) sit UNDER the caller's metadata so
  // an explicit override always wins.
  const doc: RagDocument = {
    id,
    text,
    metadata: {
      source: id,
      loader: "html",
      ...(title !== undefined ? { title } : {}),
      ...options.metadata,
    },
    tags: options.tags,
  };

  return [doc];
}

/** Internal — exported for the web loader so it shares the exact strip pass. */
export { htmlToText, extractTitle };
