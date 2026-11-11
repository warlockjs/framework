import type { ResolvedSitemapEntry } from "./types";
import { resolveAgainstBase } from "./url";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/**
 * Characters XML 1.0 forbids anywhere in a document: C0 controls other than
 * tab, newline and carriage return, U+FFFE/U+FFFF, and lone surrogates.
 */
const XML_ILLEGAL_CHARACTERS =
  // oxlint-disable-next-line eslint/no-control-regex -- removing control characters is the point.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Escapes the five XML-significant characters (a URL's query string routinely
 * contains `&`) and drops characters XML cannot carry at all, so one bad value
 * cannot make the whole file unparseable.
 */
export function escapeXml(value: string): string {
  // The character class and the table are written together, so the lookup can
  // only miss if one is edited without the other; falling back to the original
  // character keeps that editing mistake from silently emitting `undefined`
  // into a URL.
  return value
    .replace(XML_ILLEGAL_CHARACTERS, "")
    .replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const IMAGE_NAMESPACE = "http://www.google.com/schemas/sitemap-image/1.1";

/**
 * The `xmlns:xhtml` attribute exactly as it appears on `<urlset>`, including
 * its leading space. Exported so the shard writer can charge its byte length
 * against the ceiling without duplicating the string it measures.
 */
export const XHTML_NAMESPACE_ATTR = ` xmlns:xhtml="${XHTML_NAMESPACE}"`;
/** See {@link XHTML_NAMESPACE_ATTR}; measured by the shard writer before roll-over. */
export const IMAGE_NAMESPACE_ATTR = ` xmlns:image="${IMAGE_NAMESPACE}"`;

/**
 * Renders one `<url>` block. Exported so the streaming writer can measure the
 * exact bytes it is about to append before deciding whether the byte ceiling
 * forces a new shard — a separate approximation could disagree with what is
 * actually written.
 */
export function renderUrlBlock(entry: ResolvedSitemapEntry, baseUrl: string): string {
  const lines = [`  <url>`, `    <loc>${escapeXml(resolveAgainstBase(baseUrl, entry.path))}</loc>`];

  if (entry.lastmod !== undefined) {
    lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
  }

  if (entry.changefreq !== undefined) {
    lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  }

  if (entry.priority !== undefined) {
    lines.push(`    <priority>${entry.priority}</priority>`);
  }

  for (const alternate of entry.alternates ?? []) {
    const href = escapeXml(resolveAgainstBase(baseUrl, alternate.path));

    lines.push(
      `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${href}"/>`,
    );
  }

  for (const image of entry.images ?? []) {
    lines.push(`    <image:image>`);
    lines.push(`      <image:loc>${escapeXml(resolveAgainstBase(baseUrl, image.loc))}</image:loc>`);
    lines.push(`    </image:image>`);
  }

  lines.push(`  </url>`);

  return lines.join("\n");
}

/**
 * Serialises entries into a `urlset` sitemap document — the sitemaps.org
 * namespace, `<url>` per entry, element order `loc` / `lastmod` / `changefreq`
 * / `priority` (schema order; a validator that checks order rejects any other),
 * then any `xhtml:link` alternates.
 *
 * The xhtml namespace is declared only when some entry actually carries an
 * alternate — an unused namespace on every single-language sitemap is noise.
 */
export function buildSitemapXml(entries: readonly ResolvedSitemapEntry[], baseUrl: string): string {
  return buildSitemapXmlFromBlocks(
    entries.map((entry) => renderUrlBlock(entry, baseUrl)),
    entries.some((entry) => (entry.alternates?.length ?? 0) > 0),
    entries.some((entry) => (entry.images?.length ?? 0) > 0),
  );
}

/**
 * {@link buildSitemapXml} from `<url>` blocks already rendered by
 * {@link renderUrlBlock}, so the shard writer renders each entry once: the
 * block it measured is the block it writes.
 */
export function buildSitemapXmlFromBlocks(
  blocks: readonly string[],
  hasAlternates: boolean,
  hasImages: boolean,
): string {
  const namespaces = `${hasAlternates ? XHTML_NAMESPACE_ATTR : ""}${hasImages ? IMAGE_NAMESPACE_ATTR : ""}`;
  const body = blocks.join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${namespaces}>\n` +
    (body.length > 0 ? `${body}\n` : "") +
    `</urlset>\n`
  );
}
