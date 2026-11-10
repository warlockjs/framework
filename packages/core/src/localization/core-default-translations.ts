import { extend, getKeywordsListOf } from "@mongez/localization";
import { get, set } from "@mongez/reinforcements";

/**
 * Key of the CSRF origin refusal text that core owns. An application that
 * defines its own text registers the same key in its locale files.
 */
export const CSRF_ORIGIN_MISMATCH_KEY = "http.errors.csrfOriginMismatch";

/**
 * English sentence used when no locale resolves either CSRF translation key.
 */
export const CSRF_ORIGIN_MISMATCH_FALLBACK = "Request origin is not allowed.";

/**
 * Built-in text core ships for its own translation keys, by locale code.
 */
export const coreDefaultTranslations: Record<string, Record<string, unknown>> = {
  en: { http: { errors: { csrfOriginMismatch: CSRF_ORIGIN_MISMATCH_FALLBACK } } },
  ar: { http: { errors: { csrfOriginMismatch: "مصدر الطلب غير مسموح به." } } },
};

/**
 * Register core's default translations, adding only keys the application has
 * not already translated so an app's own text wins regardless of load order.
 * Safe to call more than once.
 */
export function registerCoreTranslations(): void {
  for (const [localeCode, translations] of Object.entries(coreDefaultTranslations)) {
    const existing = getKeywordsListOf(localeCode) ?? {};

    if (get(existing, CSRF_ORIGIN_MISMATCH_KEY) !== undefined) continue;

    const missing: Record<string, unknown> = {};
    set(missing, CSRF_ORIGIN_MISMATCH_KEY, get(translations, CSRF_ORIGIN_MISMATCH_KEY));
    extend(localeCode, missing as never);
  }
}
