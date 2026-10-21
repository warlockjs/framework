/**
 * The translation delivery rules that the build (which writes the hashed
 * tables) and the server (which names them in the payload) must agree on.
 *
 * Both sides derive the shared tables from the same route-locale sources, with
 * the same canonical serialization and the same hash, so the URL the server
 * puts in a payload is always the file the build emitted. Nothing here touches
 * the browser: the browser only reads the URL and the shapes in `./types`.
 */
import { createHash } from "node:crypto";
import type { Keywords } from "@mongez/localization";
import { isTranslationKeyUsed, usageOf, type TranslationUsage } from "@warlock.js/core";
import { CLIENT_ASSET_URL_PREFIX } from "../server/client-asset-url-prefix";
import {
  TRANSLATION_ASSET_DIRECTORY,
  TRANSLATION_TABLE_ROUTE_PREFIX,
  type SerializedTranslationUsage,
} from "./types";

/** One parsed route-locale file, reduced to what delivery needs: flattened key → locale → text. */
export type TranslationSourceEntries = {
  readonly entries: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

/** A usage that reaches every key: what an unknown page, or a page with pruning turned off, gets. */
export const EVERYTHING_USAGE: TranslationUsage = usageOf({ dynamic: true });

/** The top-level group a flattened key belongs to. */
export function groupOf(key: string): string {
  const dot = key.indexOf(".");
  return dot === -1 ? key : key.slice(0, dot);
}

/** Every locale code the sources carry, in first-seen order. */
export function localeCodesOf(sources: readonly TranslationSourceEntries[]): string[] {
  const codes = new Set<string>();

  for (const source of sources) {
    for (const perLocale of Object.values(source.entries)) {
      for (const code of Object.keys(perLocale)) codes.add(code);
    }
  }

  return [...codes];
}

function setLeaf(tree: Record<string, unknown>, key: string, value: string): void {
  const segments = key.split(".");
  let cursor = tree;

  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined) {
      const next: Record<string, unknown> = {};
      cursor[segment] = next;
      cursor = next;
      continue;
    }
    if (typeof existing !== "object" || existing === null) {
      throw new Error(`Translation key ${JSON.stringify(key)} collides with a namespace prefix.`);
    }
    cursor = existing as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1] ?? key] = value;
}

/**
 * The shared table of one locale: every key whose group is shared, across every
 * source. Ownership is unique across route dictionaries, so the union is exact.
 */
export function sharedTableFor(
  sources: readonly TranslationSourceEntries[],
  locale: string,
  sharedGroups: readonly string[],
): Record<string, unknown> {
  const table: Record<string, unknown> = {};
  const groups = new Set(sharedGroups);

  for (const source of sources) {
    for (const [key, perLocale] of Object.entries(source.entries)) {
      const text = perLocale[locale];
      if (text !== undefined && groups.has(groupOf(key))) setLeaf(table, key, text);
    }
  }

  return table;
}

/** The whole table of one locale, every group included. Used by the development asset. */
export function fullTableFor(
  sources: readonly TranslationSourceEntries[],
  locale: string,
): Record<string, unknown> {
  const table: Record<string, unknown> = {};

  for (const source of sources) {
    for (const [key, perLocale] of Object.entries(source.entries)) {
      const text = perLocale[locale];
      if (text !== undefined) setLeaf(table, key, text);
    }
  }

  return table;
}

/** JSON with every object's keys sorted, so equal tables serialize to equal bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(sortKeys);

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);

  return sorted;
}

/** A content hash short enough for a URL and long enough that a collision is not a concern here. */
export function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/** The emitted file of one locale's shared table, relative to the client `assets` directory. */
export function sharedAssetFileName(locale: string, hash: string): string {
  return `${TRANSLATION_ASSET_DIRECTORY}/${locale}.${hash}.json`;
}

/** The URL a payload names for an emitted file. */
export function assetUrlFor(fileName: string): string {
  return `${CLIENT_ASSET_URL_PREFIX}/${fileName}`;
}

/** One locale's shared table, serialized and named the way the build emits and the server references it. */
export type SharedTranslationAsset = {
  readonly locale: string;
  readonly fileName: string;
  readonly body: string;
  readonly hash: string;
};

/** Every locale's shared table, as the files the build writes. */
export function sharedTranslationAssets(
  sources: readonly TranslationSourceEntries[],
  sharedGroups: readonly string[],
): SharedTranslationAsset[] {
  return localeCodesOf(sources).map((locale) => {
    const body = canonicalJson(sharedTableFor(sources, locale, sharedGroups));
    const hash = contentHash(body);

    return { locale, fileName: sharedAssetFileName(locale, hash), body, hash };
  });
}

/**
 * The page's own dictionary: its keys, minus the shared groups (which the
 * shared table already provides), restricted to what the usage can reach.
 */
export function pruneKeywords(
  keywords: Readonly<Keywords>,
  usage: TranslationUsage,
  sharedGroups: readonly string[],
): Keywords {
  const shared = new Set(sharedGroups);
  const pruned: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(keywords)) {
    if (shared.has(name)) continue;

    const kept = pruneBranch(value, name, usage);
    if (kept !== undefined) pruned[name] = kept;
  }

  return pruned as Keywords;
}

function pruneBranch(value: unknown, key: string, usage: TranslationUsage): unknown {
  if (typeof value === "string") return isTranslationKeyUsed(usage, key) ? value : undefined;
  if (typeof value !== "object" || value === null) return undefined;

  const branch: Record<string, unknown> = {};

  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    const kept = pruneBranch(child, `${key}.${name}`, usage);
    if (kept !== undefined) branch[name] = kept;
  }

  return Object.keys(branch).length === 0 ? undefined : branch;
}

/** The serialized form a production manifest stores for one page's usage. */
export function serializeUsage(usage: TranslationUsage): SerializedTranslationUsage {
  return {
    keys: [...usage.keys],
    prefixes: [...usage.prefixes],
    literals: [...usage.literals],
    literalPrefixes: [...usage.literalPrefixes],
    dynamic: usage.dynamic,
  };
}

/** The inverse of {@link serializeUsage}. */
export function usageFromRecord(record: SerializedTranslationUsage): TranslationUsage {
  return usageOf({
    keys: record.keys,
    prefixes: record.prefixes,
    literals: record.literals,
    literalPrefixes: record.literalPrefixes,
    dynamic: record.dynamic,
  });
}

/**
 * The unhashed URL of a locale's newest table. A client asks for it when the
 * hashed table a payload named is missing (another process, or an older
 * deployment), and the server answers with `no-cache`.
 */
export function translationLatestUrl(locale: string): string {
  return `${TRANSLATION_TABLE_ROUTE_PREFIX}/${locale}.json`;
}

/**
 * The part of a page's dictionary it must carry itself: every leaf the table
 * does not already hold with the same value, restricted to what the usage can
 * reach. A leaf the table holds is in the client's table, so it is never
 * inlined. A registration that changed a table value is not equal, so it
 * ships inline, like any other used key.
 */
export function pruneKeywordsAgainst(
  keywords: Readonly<Keywords>,
  usage: TranslationUsage,
  table: Readonly<Record<string, unknown>>,
): Keywords {
  const pruned: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(keywords)) {
    const kept = pruneBranchAgainst(value, name, usage, table[name]);
    if (kept !== undefined) pruned[name] = kept;
  }

  return pruned as Keywords;
}

function pruneBranchAgainst(
  value: unknown,
  key: string,
  usage: TranslationUsage,
  tableNode: unknown,
): unknown {
  if (typeof value === "string") {
    if (tableNode === value) return undefined;
    return isTranslationKeyUsed(usage, key) ? value : undefined;
  }

  if (typeof value !== "object" || value === null) return undefined;

  const branch: Record<string, unknown> = {};
  const tableRecord =
    typeof tableNode === "object" && tableNode !== null
      ? (tableNode as Record<string, unknown>)
      : undefined;

  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    const kept = pruneBranchAgainst(child, `${key}.${name}`, usage, tableRecord?.[name]);
    if (kept !== undefined) branch[name] = kept;
  }

  return Object.keys(branch).length === 0 ? undefined : branch;
}
