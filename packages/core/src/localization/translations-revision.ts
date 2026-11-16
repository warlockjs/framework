import { localizationEvents } from "@mongez/localization";

export { extend, groupedTranslations, setTranslationsList } from "@mongez/localization";

let revision = 0;

// `@mongez/localization` fires this event after every `extend`,
// `groupedTranslations` and `setTranslationsList`, whichever package the call
// came from, so the revision moves for direct library calls too. The
// functions above are plain re-exports and do not bump on their own, which
// keeps each write counted once.
localizationEvents.onChange("translations", () => {
  revision += 1;
});

/**
 * A number that changes whenever translations are registered or extended,
 * through Warlock.js or directly through `@mongez/localization`. Anything
 * that caches a value derived from the translation registry keeps the number
 * it computed with and recomputes when the current one differs.
 */
export function getTranslationsRevision(): number {
  return revision;
}

/**
 * Record a registry change the library cannot report. `extend`,
 * `groupedTranslations` and `setTranslationsList` already move the revision
 * wherever they are imported from; call this only after changing translations
 * by other means.
 */
export function bumpTranslationsRevision(): void {
  revision += 1;
}
