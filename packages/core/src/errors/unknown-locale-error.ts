/**
 * Thrown by `response.setLocale(locale)` when `locale` is outside the
 * application's declared `app.localeCodes` allow-list.
 *
 * Silently writing a locale cookie for a locale the app cannot serve is a
 * NEW silent failure — `request.locale` would read the cookie back, fail its
 * own allow-list check (`Request.cacheLocale`), and fall back to the default
 * with nothing telling the caller why the switch never took. Failing here,
 * at the write, names the mistake at its source instead of downstream.
 *
 * Only raised when `app.localeCodes` is declared — with no list declared
 * there is nothing to fail against, matching `Request.cacheLocale`'s own
 * fail-open rule.
 */
export class UnknownLocaleError extends Error {
  public constructor(locale: string, localeCodes: string[]) {
    super(UnknownLocaleError.buildMessage(locale, localeCodes));
    this.name = "UnknownLocaleError";
  }

  private static buildMessage(locale: string, localeCodes: string[]): string {
    return (
      `Cannot set locale "${locale}": it is not in the configured "app.localeCodes" list ` +
      `(${localeCodes.map((code) => `"${code}"`).join(", ")}). Add "${locale}" to ` +
      `"app.localeCodes" or pass one of the configured locales instead.`
    );
  }
}
