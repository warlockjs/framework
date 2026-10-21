/**
 * The runtime store of translation tables, addressed by content hash.
 *
 * A payload names a table by `/__warlock/translations/<locale>.<hash>.json`,
 * where the hash is the SHA-256 prefix of the table's exact bytes. The same
 * hash always names the same bytes, which is what makes the response safe to
 * cache forever in production.
 *
 * Each locale keeps its most recent {@link RECENT_TRANSLATION_TABLES} tables.
 * That covers the payloads a client already holds when the table changes
 * underneath it (a registration that landed after the page loaded, or a
 * development edit). A hash older than that answers 404 with `no-store`.
 */
import { contentHash } from "../translations/delivery";
import { TRANSLATION_TABLE_ROUTE_PREFIX } from "../translations/types";

/** Tables per locale that stay servable, newest last. */
export const RECENT_TRANSLATION_TABLES = 8;

/** One stored table: its serialized body, and whether it came from development. */
export type StoredTranslationTable = {
  readonly body: string;
  readonly development: boolean;
};

const tablesByLocale = new Map<string, Map<string, StoredTranslationTable>>();

/**
 * Production tables fixed for the process lifetime. They never age out, so a
 * hash that a document names stays servable for as long as the process runs.
 */
const pinnedByLocale = new Map<string, Map<string, StoredTranslationTable>>();

/** The hash `<locale>.json` answers with: the newest table published or pinned for the locale. */
const latestByLocale = new Map<string, string>();

/** The table file name a payload references, relative to the route prefix. */
export function translationTableFileName(locale: string, hash: string): string {
  return `${locale}.${hash}.json`;
}

/** The URL a payload references for one stored table. */
export function translationTableUrl(locale: string, hash: string): string {
  return `${TRANSLATION_TABLE_ROUTE_PREFIX}/${translationTableFileName(locale, hash)}`;
}

const TABLE_FILE = /^([A-Za-z][A-Za-z0-9-]*)\.([0-9a-f]{16})\.json$/;

/** Read a route segment back into a locale and hash, or `undefined` when it is not a table name. */
export function parseTranslationTableFile(
  file: string,
): { readonly locale: string; readonly hash: string } | undefined {
  const match = TABLE_FILE.exec(file);
  if (match === null) return undefined;

  const [, locale, hash] = match;
  if (locale === undefined || hash === undefined) return undefined;

  return { locale, hash };
}

/**
 * Pin a table for the life of the process and return its hash. Production uses
 * this for the tables that must be identical in every process (the snapshot of
 * shared groups taken at boot), so two processes answer the same name with the
 * same bytes.
 */
export function pinTranslationTable(locale: string, body: string): string {
  const hash = contentHash(body);
  let pinned = pinnedByLocale.get(locale);

  if (pinned === undefined) {
    pinned = new Map<string, StoredTranslationTable>();
    pinnedByLocale.set(locale, pinned);
  }

  pinned.set(hash, { body, development: false });
  latestByLocale.set(locale, hash);

  return hash;
}

const LATEST_TABLE_FILE = /^([A-Za-z][A-Za-z0-9-]*)\.json$/;

/** The locale of an unhashed `<locale>.json` name, the fallback a client asks for when a hashed name is missing. */
export function parseLatestTableFile(file: string): string | undefined {
  return LATEST_TABLE_FILE.exec(file)?.[1];
}

/**
 * Store a table body under its content hash and return that hash. Publishing
 * an existing body moves it to the newest position, and makes it the latest.
 */
export function publishTranslationTable(
  locale: string,
  body: string,
  development: boolean,
): string {
  const hash = contentHash(body);
  let recent = tablesByLocale.get(locale);

  if (recent === undefined) {
    recent = new Map<string, StoredTranslationTable>();
    tablesByLocale.set(locale, recent);
  }

  recent.delete(hash);
  recent.set(hash, { body, development });
  latestByLocale.set(locale, hash);

  for (const oldest of recent.keys()) {
    if (recent.size <= RECENT_TRANSLATION_TABLES) break;
    recent.delete(oldest);
  }

  return hash;
}

/** The stored table for a locale and hash, or `undefined` once it has aged out (or never existed). */
export function translationTableFor(
  locale: string,
  hash: string,
): StoredTranslationTable | undefined {
  return pinnedByLocale.get(locale)?.get(hash) ?? tablesByLocale.get(locale)?.get(hash);
}

/** The newest table for a locale, whatever its hash. Serves the unhashed `<locale>.json` name. */
export function latestTranslationTableFor(locale: string): StoredTranslationTable | undefined {
  const hash = latestByLocale.get(locale);
  return hash === undefined ? undefined : translationTableFor(locale, hash);
}

/** Test seam: forget every stored table. */
export function resetTranslationTablesForTests(): void {
  tablesByLocale.clear();
  pinnedByLocale.clear();
  latestByLocale.clear();
}
