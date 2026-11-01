import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

/** Pages with more table-of-contents entries than this show second-level headings only. */
const LONG_PAGE_TOC_ENTRIES = 12;

type TocEntry = { children: TocEntry[] };

const countEntries = (items: TocEntry[]): number =>
  items.reduce((total, item) => total + 1 + countEntries(item.children), 0);

/**
 * Long pages get a short "On this page" list: H2s only. Short pages keep
 * their H3s, where the extra depth still fits on one screen.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const toc = context.locals.starlightRoute.toc;
  if (!toc || countEntries(toc.items) <= LONG_PAGE_TOC_ENTRIES) return;

  toc.items = toc.items.map((item) => ({ ...item, children: [] }));
});
