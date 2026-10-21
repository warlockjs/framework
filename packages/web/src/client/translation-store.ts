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
  /** Set once a payload with a shared-table reference arrived: its page was pruned, so a miss means something. */
  pruned: boolean;
};

/** Immutable tables, fetched once per URL. A failed load is remembered as `undefined`, so keys render instead of retrying forever. */
const tables = new Map<string, Promise<Table | undefined>>();
const locales = new Map<string, LocaleState>();
let mergedPayloads = new WeakSet<object>();
const reported = new Set<string>();

function stateOf(locale: string): LocaleState {
  const existing = locales.get(locale);
  if (existing !== undefined) return existing;

  const created: LocaleState = {
    shared: undefined,
    pageLocal: {},
    pageName: "",
    dictionary: undefined,
    pruned: false,
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

/** A table response that was not OK, keeping its status so the fallback order can read it. */
class TableResponseError extends Error {
  public readonly status: number;

  public constructor(status: number) {
    super(`The translation table answered HTTP ${status}.`);
    this.name = "TableResponseError";
    this.status = status;
  }
}

async function fetchTable(url: string): Promise<Table> {
  const response = await fetch(url, { credentials: "same-origin" });

  if (!response.ok) throw new TableResponseError(response.status);

  const parsed: unknown = await response.json();

  if (!isRecord(parsed)) throw new Error("The translation table is not a JSON object.");

  return parsed;
}

/**
 * The order a table is loaded in, and why:
 *
 * 1. The hashed URL the payload names. This is the table the document was
 *    rendered against, when it is still held.
 * 2. On a 404 only, the unhashed `latest` URL. A 404 means the name is not in
 *    this process: another process of the same deployment, or a table that aged
 *    out. The newest table of the process serves the keys, and it is
 *    revalidated (`no-cache`).
 * 3. Otherwise, or when `latest` also fails, the hashed URL once more.
 * 4. When that fails too, the failure is reported once and the page renders its
 *    keys. It never renders a blank string.
 */
async function loadTableInOrder(assets: HydrationTranslationAssets): Promise<Table> {
  try {
    return await fetchTable(assets.url);
  } catch (error) {
    if (assets.latest !== undefined && isNotFound(error)) {
      try {
        return await fetchTable(assets.latest);
      } catch {
        // Falls through to the retry of the hashed URL below.
      }
    }
  }

  return fetchTable(assets.url);
}

function isNotFound(error: unknown): boolean {
  return error instanceof TableResponseError && error.status === 404;
}

/** Load a payload's table in the documented order, once per hashed URL. */
function loadTable(assets: HydrationTranslationAssets): Promise<Table | undefined> {
  const existing = tables.get(assets.url);
  if (existing !== undefined) return existing;

  const loaded = loadTableInOrder(assets).catch((error: unknown) => {
    reportClientError("Warlock could not load its translation table", error, {
      kind: "translations",
    });
    return undefined;
  });

  tables.set(assets.url, loaded);

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
    state.pruned = true;
    const table = await loadTable(assets);
    state.shared = table === undefined ? undefined : describeShared(table, assets);
    state.dictionary = undefined;
  }

  mergePayloadTranslations(payload);
}

/**
 * Merge a payload's pruned dictionary into its locale, once per payload object.
 * Idempotent, so both the loader and the dictionary reader may call it.
 */
export function mergePayloadTranslations(payload: HydrationDocumentPayloadSource): void {
  if (mergedPayloads.has(payload)) return;

  mergedPayloads.add(payload);
  const state = stateOf(payload.locale);
  mergeInto(state.pageLocal, payload.translations);
  state.dictionary = undefined;
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
  // A payload that was never pruned delivered everything: nothing can be a pruning miss.
  if (!state.pruned) return dictionary;
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

/**
 * A mutable deep copy of a locale's dictionary, for the global registry. The
 * registry's `groupedTranslations()` writes into nested objects, so it must
 * never receive the frozen objects this store hands to React.
 */
export function registryCopyOf(locale: string): Keywords {
  return thaw(translationDictionaryFor(locale)) as Keywords;
}

function thaw(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;

  const copy: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) copy[key] = thaw(child);

  return copy;
}

/** Test seam: drop every cached table, dictionary and report. */
export function resetTranslationStoreForTests(): void {
  tables.clear();
  locales.clear();
  reported.clear();
  mergedPayloads = new WeakSet<object>();
}
