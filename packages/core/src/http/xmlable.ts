/**
 * A class contract for anything `response.xml()` can serialize.
 *
 * Structurally typed on purpose: `@warlock.js/sitemap` (or a future RSS/Atom
 * feed package) never imports core — a `Sitemap` satisfies `XMLable` just by
 * having a `toXML()` method.
 */
export interface XMLable {
  toXML(): string;
}
