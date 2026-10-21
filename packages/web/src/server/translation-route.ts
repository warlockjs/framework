import type { Router } from "@warlock.js/core";
import { parseTranslationTableFile, translationTableFor } from "./translation-tables";
import { TRANSLATION_TABLE_ROUTE_PREFIX } from "../translations/types";

/** Owns the translation table route, so a development reload replaces it instead of registering it twice. */
export const TRANSLATION_ROUTE_SOURCE_FILE = "\0warlock:translations";

/** One year, the same lifetime the bundle's hashed assets get. Safe because a name is a content hash. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Serve `GET /__warlock/translations/<locale>.<hash>.json` from the table store.
 *
 * Production answers with the immutable cache header; a development table
 * answers `no-store`, so the browser always reads the table the server holds
 * now. A name the store does not hold (never published, or aged out of the
 * recent tables) answers 404 with `no-store`, never a different body under the
 * same name.
 */
export function registerTranslationTableRoute(router: Pick<Router, "get">): void {
  router.get(`${TRANSLATION_TABLE_ROUTE_PREFIX}/*`, async ({ request, response }) => {
    const file = parseTranslationTableFile(String(request.params["*"] ?? ""));
    const table = file === undefined ? undefined : translationTableFor(file.locale, file.hash);

    if (table === undefined) {
      response.header("Cache-Control", "no-store");
      return response.send("", 404);
    }

    response.header("Cache-Control", table.development ? "no-store" : IMMUTABLE_CACHE_CONTROL);
    response.header("Content-Type", "application/json; charset=utf-8");

    return response.send(table.body);
  });
}
