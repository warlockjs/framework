import { DOCUMENT_SLOT, DOCUMENT_SLOT_ATTRIBUTE } from "../components/document-slot-marker";
import type { DocumentContextValue } from "../components/document-context";

/** The document slots the inline payload leaves out, as the document's own elements spell them. */
export type DocumentElementSlots = Pick<
  DocumentContextValue,
  | "stylesheetUrls"
  | "fontPreloads"
  | "hydrationClientModuleUrl"
  | "hydrationClientModulePreloadUrls"
  | "localeAlternates"
  | "siteKey"
>;

function marked(documentNode: Document, slot: string): Element[] {
  // A stand-in document without a query API (a test double) has no elements.
  if (typeof documentNode.querySelectorAll !== "function") return [];

  return [...documentNode.querySelectorAll(`[${DOCUMENT_SLOT_ATTRIBUTE}="${slot}"]`)];
}

/**
 * Rebuilds, from the server-rendered document, the slots `<Scripts/>` does not
 * repeat in its inline payload: stylesheet, font and module preload URLs, the
 * locale alternates, the hydration entry URL and the multi-site key. Only the
 * elements `<Head/>` and `<Scripts/>` marked are read, in document order, so the
 * hydrated `<Head/>` renders exactly the elements the server did. A slot the
 * document has no element for stays absent, as it was on the server.
 */
export function readDocumentSlots(documentNode: Document): DocumentElementSlots {
  const slots: {
    -readonly [Key in keyof DocumentElementSlots]: DocumentElementSlots[Key];
  } = {};

  const stylesheetUrls = marked(documentNode, DOCUMENT_SLOT.stylesheet).map(
    (element) => element.getAttribute("href") ?? "",
  );
  if (stylesheetUrls.length > 0) slots.stylesheetUrls = stylesheetUrls;

  const modulePreloadUrls = marked(documentNode, DOCUMENT_SLOT.modulePreload).map(
    (element) => element.getAttribute("href") ?? "",
  );
  if (modulePreloadUrls.length > 0) slots.hydrationClientModulePreloadUrls = modulePreloadUrls;

  const fontPreloads = marked(documentNode, DOCUMENT_SLOT.fontPreload).map((element) => ({
    href: element.getAttribute("href") ?? "",
    type: element.getAttribute("type") ?? "",
  }));
  if (fontPreloads.length > 0) slots.fontPreloads = fontPreloads;

  const localeAlternates = marked(documentNode, DOCUMENT_SLOT.alternate).map((element) => ({
    hreflang: element.getAttribute("hreflang") ?? "",
    href: element.getAttribute("href") ?? "",
  }));
  if (localeAlternates.length > 0) slots.localeAlternates = localeAlternates;

  const entry = marked(documentNode, DOCUMENT_SLOT.entry)[0];
  const entryUrl = entry?.getAttribute("src");

  if (entryUrl !== null && entryUrl !== undefined) slots.hydrationClientModuleUrl = entryUrl;

  const siteKey = entry?.getAttribute("data-warlock-site");

  if (siteKey !== null && siteKey !== undefined) slots.siteKey = siteKey;

  return slots;
}
