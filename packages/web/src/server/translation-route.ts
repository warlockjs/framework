import type { Router } from "@warlock.js/core";
import { localeCodesOf, type TranslationSourceEntries } from "../translations/delivery";
import { DEVELOPMENT_TRANSLATION_ROUTE_PREFIX, developmentTableBody } from "./translation-delivery";

/**
 * Owns the development translation routes, so a dev reload replaces them
 * instead of registering their names a second time.
 */
export const TRANSLATION_ROUTE_SOURCE_FILE = "\0warlock:translations";

/**
 * Register one route per locale that serves that locale's FULL table. The
 * development payload points at these with a revision in the query string, and
 * they answer `no-store`, so the browser always reads the table the server holds
 * now. Production never registers them: production serves the hashed files the
 * build wrote.
 */
export function registerDevelopmentTranslationRoutes(
  router: Router,
  sources: readonly TranslationSourceEntries[],
): void {
  for (const locale of localeCodesOf(sources)) {
    router.get(
      `${DEVELOPMENT_TRANSLATION_ROUTE_PREFIX}/${encodeURIComponent(locale)}`,
      ({ response }) => {
        response.header("Cache-Control", "no-store");
        response.header("Content-Type", "application/json; charset=utf-8");

        return response.send(developmentTableBody(sources, locale));
      },
    );
  }
}
