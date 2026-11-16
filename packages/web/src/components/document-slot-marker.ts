/**
 * The attribute `<Head/>` and `<Scripts/>` put on the elements they render from
 * document slots (stylesheets, font and module preloads, locale alternates, the
 * hydration entry script). The inline payload leaves those slots out because
 * the document already carries them; the browser reads them back from the
 * elements carrying this attribute before it hydrates
 * (`client/read-document-slots.ts`), so the hydrated tree renders the same
 * markup. Elements an app renders itself never carry it and are never read.
 */
export const DOCUMENT_SLOT_ATTRIBUTE = "data-wl";

/** The value each slot's elements carry. */
export const DOCUMENT_SLOT = {
  stylesheet: "css",
  modulePreload: "mp",
  fontPreload: "font",
  alternate: "alt",
  entry: "entry",
} as const;

/**
 * The document slots the inline payload does not repeat, because the document
 * already carries them (as elements marked above, a meta tag or a script).
 */
export const INLINE_PAYLOAD_OMITTED_DOCUMENT_SLOTS = [
  "namedApiRoutes",
  "localeRouting",
  "stylesheetUrls",
  "fontPreloads",
  "hydrationClientModuleUrl",
  "hydrationClientModulePreloadUrls",
  "localeAlternates",
  "siteKey",
] as const;
