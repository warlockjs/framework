const GROUPED_TRANSLATIONS_MARKER = "groupedTranslations";

/**
 * Cheap pre-filter for candidate translation-registering source files.
 *
 * `groupedTranslations` calls used to be scanned for on dedicated
 * `src/**​/utils/locales.*` files only, so a web module registering keys
 * elsewhere (e.g. `src/web/layout.register.ts`) was silently invisible to the
 * generator. Any app source file can call it, so discovery has to consider
 * every file — this text check keeps that cheap by skipping the AST parse
 * for the files that plainly do not call it, without executing app code.
 */
export function isTranslationRegisteringSource(source: string): boolean {
  return source.includes(GROUPED_TRANSLATIONS_MARKER);
}
