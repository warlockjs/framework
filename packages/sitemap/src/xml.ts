import type { SitemapEntry } from "./types";
import { joinOrigin } from "./url";

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

function entryXml(entry: SitemapEntry, origin: string): string {
  const lines = [`  <url>`, `    <loc>${escapeXml(joinOrigin(origin, entry.path))}</loc>`];

  if (entry.lastmod !== undefined) {
    lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
  }

  if (entry.changefreq !== undefined) {
    lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  }

  if (entry.priority !== undefined) {
    lines.push(`    <priority>${entry.priority}</priority>`);
  }

  lines.push(`  </url>`);

  return lines.join("\n");
}

/**
 * Serialises entries into a `urlset` sitemap document — the sitemaps.org
 * namespace, `<url>` per entry, element order `loc` / `lastmod` / `changefreq`
 * / `priority` (schema order; a validator that checks order rejects any other).
 */
export function buildSitemapXml(entries: readonly SitemapEntry[], origin: string): string {
  const body = entries.map((entry) => entryXml(entry, origin)).join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    (body.length > 0 ? `${body}\n` : "") +
    `</urlset>\n`
  );
}
