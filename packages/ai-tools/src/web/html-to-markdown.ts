/**
 * Dependency-free HTML to Markdown / plain-text converter used by the
 * `"simple"` extractor of `fetch_url`. It is a pragmatic tag-stream
 * reduction (headings, paragraphs, lists, links, code, quotes, tables),
 * not a full HTML parser; it needs no optional peer.
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
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  const region = findMainRegion(source);
  const hasRegion = region !== source;

  const tokens = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let output = "";
  let cursor = 0;
  let skipTag: string | undefined;
  let skipDepth = 0;
  let preDepth = 0;
  const lists: ListFrame[] = [];
  const links: LinkFrame[] = [];
  let quoteDepth = 0;
  let cellCount = 0;

  const append = (text: string): void => {
    output += text;
  };

  /** Start a new block: ensure a blank line before the next content. */
  const blockBreak = (): void => {
    if (output.length === 0 || output.endsWith("\n\n")) {
      return;
    }

    output = output.endsWith("\n") ? `${output}\n` : `${output}\n\n`;
  };

  /** Break the current line without a blank line. */
  const lineBreak = (): void => {
    if (output.length > 0 && !output.endsWith("\n")) {
      output += "\n";
    }
  };

  const quotePrefix = (): string => (quoteDepth > 0 && !plain ? `${"> ".repeat(quoteDepth)}` : "");

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
              output = output.slice(0, -1);
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
          const indent = "  ".repeat(Math.max(0, lists.length - 1));

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

  for (let match = tokens.exec(region); match !== null; match = tokens.exec(region)) {
    if (skipTag === undefined) {
      writeText(region.slice(cursor, match.index));
    }

    cursor = match.index + match[0].length;

    const name = (match[2] ?? "").toLowerCase();
    const closing = match[1] === "/";
    const selfClosed = !closing && (match[3] ?? "").trimEnd().endsWith("/");

    handleTag(closing, name, match[3] ?? "");

    if (selfClosed && !VOID.has(name) && skipTag === name) {
      skipTag = undefined;
      skipDepth = 0;
    }
  }

  if (skipTag === undefined) {
    writeText(region.slice(cursor));
  }

  return output
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Return the inner HTML of the first `<main>` or `<article>` region, else the input. */
function findMainRegion(html: string): string {
  for (const tag of ["main", "article"]) {
    const open = new RegExp(`<${tag}(\\s[^>]*)?>`, "i").exec(html);

    if (!open) {
      continue;
    }

    const from = open.index + open[0].length;
    const close = html.toLowerCase().lastIndexOf(`</${tag}>`);

    if (close > from) {
      return html.slice(from, close);
    }
  }

  return html;
}
