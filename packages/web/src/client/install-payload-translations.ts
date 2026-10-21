import { extend, type Keywords } from "@mongez/localization";
import type { HydrationDocumentPayloadSource } from "../hydration-payload";
import { mergePayloadTranslations, translationDictionaryFor } from "./translation-store";

/**
 * The immutable dictionary a scoped payload's locale renders with: its shared
 * table and every page merged so far (see `translation-store.ts`). Stable across
 * rerenders until a navigation merges something new.
 */
export function scopedPayloadTranslations(
  payload: HydrationDocumentPayloadSource,
): Readonly<Keywords> | undefined {
  if (payload.translationMode !== "scoped") return undefined;

  mergePayloadTranslations(payload);

  return translationDictionaryFor(payload.locale);
}

/**
 * Install a payload's `translations` into `@mongez/localization`'s
 * process-global table for `payload.locale` — the one action every client
 * render of a payload must take before anything reads that table.
 *
 * `hydrate-page.tsx`'s initial hydration and `build-hydrated-tree.ts`'s
 * `buildHydratedTree` (navigation, `refresh()`, `changeLocaleCode()`, and the
 * initial hydration tree alike) both need this done before `registerModules`
 * runs and before the dev-only completeness assertion reads the table —
 * `build-hydration-payload.ts`'s `translations` key already carries the
 * server's full locale table, so a page/layout `register()` hook was never
 * the only way to get a keyword registered; it is one contributor among
 * several, this being the one every payload carries unconditionally.
 */
export function installPayloadTranslations(payload: HydrationDocumentPayloadSource): void {
  if (payload.translationMode === "scoped") return;

  extend(payload.locale, payload.translations);
}
