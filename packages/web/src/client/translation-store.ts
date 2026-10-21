/**
 * The browser's translation dictionary, built from two sources: the shared
 * table of the locale (fetched once, cached by its hashed URL) and the pruned
 * dictionary of every payload the page has received, merged in as navigation
 * brings new pages.
 *
 * Hydration waits on {@link loadTranslationAssets}, so the first client render
 * sees exactly the keys the server rendered with. A translation the page's code
 * reads but the dictionary lacks is a pruning miss: development resolves it from
 * the full table and says what to declare; production renders the key and
 * reports it once through client error reporting.
 */
import type { Keywords } from "@mongez/localization";
import type { HydrationDocumentPayloadSource } from "../hydration-payload";
import type { HydrationTranslationAssets } from "../translations/types";
import { reportClientError } from "./report-client-error";

type Table = Readonly<Record<string, unknown>>;

/** A shared table as loaded, with the groups it provides to the dictionary. */
type SharedTable = {
  readonly table: Table;
  readonly groups: readonly string[];
  readonly development: boolean;
};

type LocaleState = {
  shared: SharedTable | undefined;
  /** The merged pruned dictionaries of every payload this locale has delivered. */
  pageLocal: Record<string, unknown>;
  pageName: string;
  dictionary: Readonly<Keywords> | undefined;
};

/** Immutable tables, fetched once per URL. A failed load is remembered as `undefined`, so keys render instead of retrying forever. */
const tables = new Map<string, Promise<Table | undefined>>();
const locales = new Map<string, LocaleState>();
const mergedPayloads = new WeakSet<object>();
const reported = new Set<string>();

function stateOf(locale: string): LocaleState {
  const existing = locales.get(locale);
  if (existing !== undefined) return existing;

  const created: LocaleState = {
    shared: undefined,
    pageLocal: {},
    pageName: "",
    dictionary: undefined,
  };
  locales.set(locale, created);

  return created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursive merge of plain objects; a later leaf replaces an earlier one. */
function mergeInto(
  target: Record<string, unknown>,
  source: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];

    if (isRecord(current) && isRecord(value)) {
      mergeInto(current, value);
    } else if (isRecord(value)) {
      const copy: Record<string, unknown> = {};
      mergeInto(copy, value);
      target[key] = copy;
    } else {
      target[key] = value;
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;

  for (const child of Object.values(value)) deepFreeze(child);

  return Object.freeze(value);
}

async function fetchTable(url: string): Promise<Table> {
  const response = await fetch(url, { credentials: "same-origin" });

  if (!response.ok) throw new Error(`The translation table answered HTTP ${response.status}.`);

  const parsed: unknown = await response.json();

  if (!isRecord(parsed)) throw new Error("The translation table is not a JSON object.");

  return parsed;
}

/** Fetch once, retry once, then give up loudly: the page keeps rendering its keys. */
function loadTable(url: string): Promise<Table | undefined> {
  const existing = tables.get(url);
  if (existing !== undefined) return existing;

  const loaded = fetchTable(url)
    .catch(() => fetchTable(url))
    .catch((error: unknown) => {
      reportClientError("Warlock could not load its translation table", error, {
        kind: "translations",
      });
      return undefined;
    });

  tables.set(url, loaded);

  return loaded;
}

/**
 * Make a payload's translations available to the dictionary, and wait for the
 * shared table it names. Hydration and every client navigation call this before
 * they build the tree, so the render that follows sees the merged dictionary.
 *
 * A payload without a shared-table reference (a server that does not prune, or
 * the legacy shape) still merges its dictionary; it just has nothing to load.
 */
export async function loadTranslationAssets(
  payload: HydrationDocumentPayloadSource,
): Promise<void> {
  const state = stateOf(payload.locale);
  state.pageName = payload.name;

  const assets = payload.translationAssets;

  if (assets !== undefined) {
    const table = await loadTable(assets.url);
    state.shared = table === undefined ? undefined : describeShared(table, assets);
    state.dictionary = undefined;
  }

  if (!mergedPayloads.has(payload)) {
    mergedPayloads.add(payload);
    mergeInto(state.pageLocal, payload.translations);
    state.dictionary = undefined;
  }
}

function describeShared(table: Table, assets: HydrationTranslationAssets): SharedTable {
  return { table, groups: assets.groups, development: assets.development === true };
}

/**
 * The dictionary of one locale: the shared groups, completed by every merged
 * page. Stable identity until something merges, so React memoization holds.
 */
export function translationDictionaryFor(locale: string): Readonly<Keywords> {
  const state = stateOf(locale);
  if (state.dictionary !== undefined) return state.dictionary;

  // Merged, never assigned: a merge copies the shared table's objects instead of
  // aliasing them, so a later page's keys cannot write into the shared table.
  const merged: Record<string, unknown> = {};

  if (state.shared !== undefined) {
    const groups = new Set(state.shared.groups);
    const sharedGroups: Record<string, unknown> = {};

    for (const [group, value] of Object.entries(state.shared.table)) {
      if (groups.has(group)) sharedGroups[group] = value;
    }

    mergeInto(merged, sharedGroups);
  }

  mergeInto(merged, state.pageLocal);
  state.dictionary = deepFreeze(merged) as Readonly<Keywords>;

  return state.dictionary;
}

function hasKeyword(keywords: Readonly<Record<string, unknown>>, keyword: string): boolean {
  let value: unknown = keywords;

  for (const segment of keyword.split(".")) {
    if (!isRecord(value) || !Object.hasOwn(value, segment)) return false;
    value = value[segment];
  }

  return true;
}

/**
 * The dictionary a single lookup should use. A key the dictionary has is used
 * as is. A key it lacks is a pruning miss: in development the full table
 * answers it (with a warning that says what to declare); in production the key
 * is left to render, and the miss is reported once.
 */
export function translationsForKeyword(
  locale: string,
  dictionary: Readonly<Keywords>,
  keyword: unknown,
): Readonly<Keywords> {
  // The server renders with the full table, so a miss there is a real missing key
  // and not a pruning miss; only the browser keeps this state.
  if (typeof window === "undefined") return dictionary;
  if (typeof keyword !== "string" || hasKeyword(dictionary, keyword)) return dictionary;

  const state = stateOf(locale);
  const page = state.pageName;
  const full =
    state.shared?.development === true && hasKeyword(state.shared.table, keyword)
      ? (state.shared.table as Readonly<Keywords>)
      : undefined;
  const once = `${locale}\u0000${page}\u0000${keyword}`;

  if (reported.has(once)) return full ?? dictionary;

  reported.add(once);

  if (full !== undefined) {
    console.warn(
      `[warlock:web] Translation key "${keyword}" was not in the payload of page "${page}", ` +
        "so the page's client code reads a key the build did not ship. Declare it in the " +
        `page's setup file: export const config = { translations: ["${keyword}"] }. ` +
        "The value is taken from the full development table.",
    );
    return full;
  }

  reportClientError(
    `Translation key "${keyword}" was not delivered to page "${page}"`,
    new Error(
      `The page "${page}" rendered the translation key "${keyword}", which is not in its payload. ` +
        "Declare the keys it uses with config.translations in the page's setup file.",
    ),
    { kind: "translations", routeName: page },
  );

  return dictionary;
}

/** Test seam: drop every cached table, dictionary and report. */
export function resetTranslationStoreForTests(): void {
  tables.clear();
  locales.clear();
  reported.clear();
}
