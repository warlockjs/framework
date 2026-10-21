import type { Router } from "@warlock.js/core";
import {
  latestTranslationTableFor,
  parseLatestTableFile,
  parseTranslationTableFile,
  translationTableFor,
} from "./translation-tables";
import { TRANSLATION_TABLE_ROUTE_PREFIX } from "../translations/types";

/** Owns the translation table route, so a development reload replaces it instead of registering it twice. */
export const TRANSLATION_ROUTE_SOURCE_FILE = "\0warlock:translations";

/** One year, the same lifetime the bundle's hashed assets get. Safe because a hashed name is a content hash. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * The unhashed name answers the newest table, so it must be revalidated: it
 * changes whenever the table does.
 */
const LATEST_CACHE_CONTROL = "no-cache";

/**
 * Serve the translation tables under `/__warlock/translations/`:
 *
 * - `<locale>.<hash>.json` answers that exact table. Production marks it
 *   `public, max-age=31536000, immutable`; a development table answers
 *   `no-store`. A name the server does not hold (never published, or aged out
 *   of the recent tables) answers 404 with `no-store`, never different bytes
 *   under the same name.
 * - `<locale>.json` answers the newest table for the locale, with `no-cache`.
 *   A client falls back to it when a hashed name it was given is missing (a
 *   document from another process or an older deployment).
 */
export function registerTranslationTableRoute(router: Pick<Router, "get">): void {
  router.get(`${TRANSLATION_TABLE_ROUTE_PREFIX}/*`, async ({ request, response }) => {
    const file = String(request.params["*"] ?? "");
    const hashed = parseTranslationTableFile(file);
    const latestLocale = hashed === undefined ? parseLatestTableFile(file) : undefined;

    const table =
      hashed !== undefined
        ? translationTableFor(hashed.locale, hashed.hash)
        : latestLocale === undefined
          ? undefined
          : latestTranslationTableFor(latestLocale);

    if (table === undefined) {
      response.header("Cache-Control", "no-store");
      return response.send("", 404);
    }

    response.header(
      "Cache-Control",
      table.development
        ? "no-store"
        : hashed !== undefined
          ? IMMUTABLE_CACHE_CONTROL
          : LATEST_CACHE_CONTROL,
    );
    response.header("Content-Type", "application/json; charset=utf-8");

    return response.send(table.body);
  });
}
