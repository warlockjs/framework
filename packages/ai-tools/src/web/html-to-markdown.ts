/**
 * Dependency-free HTML to Markdown / plain-text converter used by the
 * `"simple"` extractor of `fetch_url`. It is a pragmatic tag-stream
 * reduction (headings, paragraphs, lists, links, code, quotes, tables),
 * not a full HTML parser; it needs no optional peer.
 *
 * Every pass is linear in the size of the page: fetched HTML is untrusted,
 * so the tokenizer, comment stripper and region finder are hand-written
 * scanners (an unterminated `<tag` or `<!--` cannot make them rescan the
 * rest of the document), and the output is collected in parts rather than
 * re-read as one growing string.
 */

/** Options for {@link htmlToMarkdown}. */
export interface HtmlToMarkdownOptions {
  /**
   * Emit plain text: no heading hashes, link targets, emphasis or code
   * markup. Block structure (paragraph breaks, list bullets) is kept.
   *
   * @default false
   */
  plain?: boolean;
}

/** Elements whose whole subtree is dropped. */
const SKIPPED = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
  "iframe",
  "canvas",
  "select",
  "button",
  "form",
]);

/** Page chrome dropped only when the page has no `main` / `article` region. */
const CHROME = new Set(["nav", "header", "footer", "aside"]);

/** Elements that start and end a block (paragraph break around them). */
const BLOCKS = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "nav",
  "aside",
  "figure",
  "figcaption",
  "table",
  "tr",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "details",
  "summary",
  "address",
  "fieldset",
]);

/**
 * Deepest list / blockquote nesting written as indentation or `> `
 * prefixes. Deeper levels reuse this depth, so a page of thousands of
 * unclosed `<ul><li>` or `<blockquote>` tags cannot make the output grow
 * with the square of its size.
 */
const MAX_NESTING_PREFIX = 16;

/** Elements that never have a closing tag. */
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "area", "base", "col", "wbr"]);

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
  bull: "•",
  middot: "·",
  times: "×",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  deg: "°",
};

/** Decode named (common) and numeric HTML entities. Unknown ones stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);

      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        return match;
      }

      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }

    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Read one attribute value out of a raw tag attribute string. */
function readAttribute(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = pattern.exec(attributes);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];

  return value === undefined ? undefined : decodeEntities(value);
}

/** The ASCII letter test the tag-name grammar uses: `[a-zA-Z]`. */
function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** A tag-name character: `[a-zA-Z0-9-]`. */
function isTagNameChar(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 45;
}

/**
 * Remove every `<!-- … -->` comment in one forward pass. An opening
 * `<!--` with no terminator after it is left as written, and so is
 * everything after it (no later comment can be terminated either).
 */
function stripComments(html: string): string {
  let result = "";
  let from = 0;

  for (;;) {
    const open = html.indexOf("<!--", from);

    if (open === -1) {
      break;
    }

    const close = html.indexOf("-->", open + 4);

    if (close === -1) {
      break;
    }

    result += html.slice(from, open);
    from = close + 3;
  }

  return from === 0 ? html : result + html.slice(from);
}

/**
 * For every position `p`, the index of the `>` that closes a tag whose
 * attribute section starts at `p` — skipping `"…"` and `'…'` quoted runs
 * (which may contain `>`) — or `-1` when no such `>` exists (end of input,
 * or a quote that is never closed). Computed right to left in one pass, so
 * an unterminated tag costs nothing extra no matter how many there are.
 */
function attributeEnds(html: string): Int32Array {
  const ends = new Int32Array(html.length + 1);
  let nextDouble = -1;
  let nextSingle = -1;

  ends[html.length] = -1;

  for (let index = html.length - 1; index >= 0; index--) {
    const code = html.charCodeAt(index);

    if (code === 62) {
      // `>`
      ends[index] = index;
    } else if (code === 34) {
      // `"` — continue after its closing quote.
      ends[index] = nextDouble === -1 ? -1 : (ends[nextDouble + 1] ?? -1);
      nextDouble = index;
    } else if (code === 39) {
      // `'`
      ends[index] = nextSingle === -1 ? -1 : (ends[nextSingle + 1] ?? -1);
      nextSingle = index;
    } else {
      ends[index] = ends[index + 1] ?? -1;
    }
  }

  return ends;
}

/** One tag read by {@link readTag}. */
interface TagToken {
  closing: boolean;
  /** Tag name as written (not lower-cased). */
  name: string;
  /** Raw attribute text between the name and `>`. */
  attributes: string;
  /** Index just past the closing `>`. */
  end: number;
}

/**
 * Read the tag that starts with the `<` at `start`: an optional `/`, a
 * name (`[a-zA-Z][a-zA-Z0-9-]*`), attributes with quoted values, then
 * `>`. Returns `undefined` when the `<` does not start a complete tag.
 */
function readTag(html: string, start: number, ends: Int32Array): TagToken | undefined {
  let index = start + 1;
  const closing = html.charCodeAt(index) === 47; // `/`

  if (closing) {
    index += 1;
  }

  if (!isAsciiLetter(html.charCodeAt(index))) {
    return undefined;
  }

  const nameStart = index;

  while (index < html.length && isTagNameChar(html.charCodeAt(index))) {
    index += 1;
  }

  const close = ends[index] ?? -1;

  if (close === -1) {
    return undefined;
  }

  return {
    closing,
    name: html.slice(nameStart, index),
    attributes: html.slice(index, close),
    end: close + 1,
  };
}

/**
 * The converted text, kept as a list of parts plus its last two
 * characters, so checking how the output ends never re-reads (or
 * flattens) the whole string.
 */
class OutputBuffer {
  private readonly parts: string[] = [];
  /** The last (up to) two characters written. */
  private tail = "";
  /** Total characters written. */
  public length = 0;

  public append(text: string): void {
    if (text.length === 0) {
      return;
    }

    this.parts.push(text);
    this.length += text.length;
    this.tail = text.length >= 2 ? text.slice(-2) : (this.tail + text).slice(-2);
  }

  /** Whether the output ends with `suffix` (at most two characters). */
  public endsWith(suffix: string): boolean {
    return this.tail.endsWith(suffix);
  }

  /** Drop the last character written. */
  public dropLast(): void {
    const last = this.parts.pop();

    if (last === undefined) {
      return;
    }

    if (last.length > 1) {
      this.parts.push(last.slice(0, -1));
    }

    this.length -= 1;

    let tail = "";

    for (let index = this.parts.length - 1; index >= 0 && tail.length < 2; index--) {
      tail = (this.parts[index] ?? "").slice(-2) + tail;
    }

    this.tail = tail.slice(-2);
  }

  public toString(): string {
    return this.parts.join("");
  }
}

/** Remove trailing spaces and tabs from one line. */
function trimLineEnd(line: string): string {
  let end = line.length;

  while (end > 0) {
    const code = line.charCodeAt(end - 1);

    if (code !== 32 && code !== 9) {
      break;
    }

    end -= 1;
  }

  return end === line.length ? line : line.slice(0, end);
}

interface ListFrame {
  ordered: boolean;
  index: number;
}

interface LinkFrame {
  href: string | undefined;
  /** Output length when the link opened, to drop empty links. */
  start: number;
}

/**
 * Convert an HTML document (or fragment) to Markdown, or to plain text
 * with `{ plain: true }`. Scripts, styles and page chrome are dropped;
 * when the page has a `<main>` or `<article>` region only that region is
 * converted.
 */
export function htmlToMarkdown(html: string, options?: HtmlToMarkdownOptions): string {
  const plain = options?.plain ?? false;
  const source = stripComments(html);
  const region = findMainRegion(source);
  const hasRegion = region !== source;

  const output = new OutputBuffer();
  let cursor = 0;
  let skipTag: string | undefined;
  let skipDepth = 0;
  let preDepth = 0;
  const lists: ListFrame[] = [];
  const links: LinkFrame[] = [];
  let quoteDepth = 0;
  let cellCount = 0;

  const append = (text: string): void => {
    output.append(text);
  };

  /** Start a new block: ensure a blank line before the next content. */
  const blockBreak = (): void => {
    if (output.length === 0 || output.endsWith("\n\n")) {
      return;
    }

    output.append(output.endsWith("\n") ? "\n" : "\n\n");
  };

  /** Break the current line without a blank line. */
  const lineBreak = (): void => {
    if (output.length > 0 && !output.endsWith("\n")) {
      output.append("\n");
    }
  };

  const quotePrefix = (): string =>
    quoteDepth > 0 && !plain ? `${"> ".repeat(Math.min(quoteDepth, MAX_NESTING_PREFIX))}` : "";

  const writeText = (raw: string): void => {
    if (raw.length === 0) {
      return;
    }

    if (preDepth > 0) {
      append(decodeEntities(raw));

      return;
    }

    const collapsed = decodeEntities(raw).replace(/[ \t\r\n\f ]+/g, " ");

    if (collapsed.trim().length === 0) {
      if (output.length > 0 && !output.endsWith("\n") && !output.endsWith(" ")) {
        append(" ");
      }

      return;
    }

    let text = collapsed;

    if (output.length === 0 || output.endsWith("\n") || output.endsWith(" ")) {
      text = text.replace(/^ /, "");
    }

    if (output.length === 0 || output.endsWith("\n")) {
      append(quotePrefix());
    }

    append(text);
  };

  const handleTag = (closing: boolean, name: string, attributes: string): void => {
    if (skipTag !== undefined) {
      if (name === skipTag) {
        skipDepth += closing ? -1 : 1;

        if (skipDepth === 0) {
          skipTag = undefined;
        }
      }

      return;
    }

    if (!closing && SKIPPED.has(name)) {
      if (!VOID.has(name)) {
        skipTag = name;
        skipDepth = 1;
      }

      return;
    }

    if (!closing && CHROME.has(name) && !hasRegion) {
      skipTag = name;
      skipDepth = 1;

      return;
    }

    if (/^h[1-6]$/.test(name)) {
      blockBreak();

      if (!closing && !plain) {
        append(`${"#".repeat(Number(name[1]))} `);
      }

      if (closing) {
        blockBreak();
      }

      return;
    }

    switch (name) {
      case "br":
        append("\n");
        return;
      case "hr":
        blockBreak();
        append(plain ? "" : "---");
        blockBreak();
        return;
      case "img": {
        const alt = readAttribute(attributes, "alt");

        if (alt && alt.trim().length > 0) {
          writeText(plain ? alt : `![${alt.trim()}](${readAttribute(attributes, "src") ?? ""})`);
        }

        return;
      }
      case "a":
        if (closing) {
          const frame = links.pop();

          if (frame && !plain && frame.href) {
            if (output.length > frame.start) {
              append(`](${frame.href})`);
            } else {
              // Empty link text: drop the opening bracket.
              output.dropLast();
            }
          }
        } else {
          const href = readAttribute(attributes, "href");
          const usable = href !== undefined && !/^(javascript:|#)/i.test(href.trim());

          if (usable && !plain) {
            append("[");
          }

          links.push({ href: usable ? href.trim() : undefined, start: output.length });
        }

        return;
      case "strong":
      case "b":
        if (!plain) {
          append("**");
        }

        return;
      case "em":
      case "i":
        if (!plain) {
          append("_");
        }

        return;
      case "pre":
        if (closing) {
          preDepth = Math.max(0, preDepth - 1);
          lineBreak();

          if (!plain) {
            append("```");
          }

          blockBreak();
        } else {
          blockBreak();

          if (!plain) {
            append("```\n");
          }

          preDepth += 1;
        }

        return;
      case "code":
        if (preDepth === 0 && !plain) {
          append("`");
        }

        return;
      case "blockquote":
        blockBreak();
        quoteDepth += closing ? -1 : 1;
        quoteDepth = Math.max(0, quoteDepth);
        blockBreak();
        return;
      case "ul":
      case "ol":
        if (closing) {
          lists.pop();

          if (lists.length > 0) {
            lineBreak();
          } else {
            blockBreak();
          }
        } else {
          if (lists.length > 0) {
            lineBreak();
          } else {
            blockBreak();
          }

          lists.push({ ordered: name === "ol", index: 0 });
        }

        return;
      case "li":
        if (!closing) {
          lineBreak();

          const frame = lists[lists.length - 1];
          const indent = "  ".repeat(Math.min(Math.max(0, lists.length - 1), MAX_NESTING_PREFIX));

          if (frame) {
            frame.index += 1;
          }

          append(quotePrefix());
          append(`${indent}${frame?.ordered ? `${frame.index}.` : "-"} `);
        } else {
          lineBreak();
        }

        return;
      case "tr":
        if (closing) {
          lineBreak();
        } else {
          lineBreak();
          cellCount = 0;
        }

        return;
      case "td":
      case "th":
        if (!closing) {
          if (cellCount > 0) {
            append(plain ? "\t" : " | ");
          }

          cellCount += 1;
        }

        return;
      default:
        break;
    }

    if (BLOCKS.has(name)) {
      blockBreak();
    }
  };

  const ends = attributeEnds(region);

  for (let start = region.indexOf("<"); start !== -1;) {
    const tag = readTag(region, start, ends);

    if (tag === undefined) {
      start = region.indexOf("<", start + 1);
      continue;
    }

    if (skipTag === undefined) {
      writeText(region.slice(cursor, start));
    }

    cursor = tag.end;

    const name = tag.name.toLowerCase();
    const selfClosed = !tag.closing && tag.attributes.trimEnd().endsWith("/");

    handleTag(tag.closing, name, tag.attributes);

    if (selfClosed && !VOID.has(name) && skipTag === name) {
      skipTag = undefined;
      skipDepth = 0;
    }

    start = region.indexOf("<", tag.end);
  }

  if (skipTag === undefined) {
    writeText(region.slice(cursor));
  }

  return output
    .toString()
    .split("\n")
    .map(trimLineEnd)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Index just past the first `<tag>` / `<tag …>` opening (tag name matched
 * case-insensitively), or `-1`. One forward pass: a candidate followed by
 * whitespace either reaches the next `>` or, when there is none, no later
 * candidate can match.
 */
function findOpeningTagEnd(html: string, tag: string): number {
  const lowerTag = tag.toLowerCase();

  for (let start = html.indexOf("<"); start !== -1; start = html.indexOf("<", start + 1)) {
    if (html.slice(start + 1, start + 1 + tag.length).toLowerCase() !== lowerTag) {
      continue;
    }

    const after = start + 1 + tag.length;
    const next = html.charAt(after);

    if (next === ">") {
      return after + 1;
    }

    if (next !== "" && /\s/.test(next)) {
      const close = html.indexOf(">", after);

      return close === -1 ? -1 : close + 1;
    }
  }

  return -1;
}

/** Return the inner HTML of the first `<main>` or `<article>` region, else the input. */
function findMainRegion(html: string): string {
  for (const tag of ["main", "article"]) {
    const from = findOpeningTagEnd(html, tag);

    if (from === -1) {
      continue;
    }

    const close = html.toLowerCase().lastIndexOf(`</${tag}>`);

    if (close > from) {
      return html.slice(from, close);
    }
  }

  return html;
}
