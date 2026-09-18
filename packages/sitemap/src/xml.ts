import type { ResolvedSitemapEntry } from "./types";
import { resolveAgainstBase } from "./url";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapes the five XML-significant characters. A URL's query string routinely contains `&`. */
export function escapeXml(value: string): string {
  // The character class and the table are written together, so the lookup can
  // only miss if one is edited without the other; falling back to the original
  // character keeps that editing mistake from silently emitting `undefined`
  // into a URL.
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function entryXml(entry: ResolvedSitemapEntry, baseUrl: string): string {
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
  const hasAlternates = entries.some((entry) => (entry.alternates?.length ?? 0) > 0);
  const namespaces = hasAlternates ? ` xmlns:xhtml="${XHTML_NAMESPACE}"` : "";
  const body = entries.map((entry) => entryXml(entry, baseUrl)).join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${namespaces}>\n` +
    (body.length > 0 ? `${body}\n` : "") +
    `</urlset>\n`
  );
}
