import { InvalidSitemapEntryError } from "./errors";
import { formatLastmod } from "./lastmod";
import type { ChangeFreq, ResolvedSitemapEntry, SitemapEntry, SitemapOptions } from "./types";

const CHANGE_FREQS: readonly ChangeFreq[] = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
];

function assertChangeFreq(value: unknown): asserts value is ChangeFreq {
  if (!CHANGE_FREQS.includes(value as ChangeFreq)) {
    throw new InvalidSitemapEntryError(
      `changefreq ${JSON.stringify(value)} is not one of ${CHANGE_FREQS.join(", ")}`,
    );
  }
}

function assertPriority(value: unknown): asserts value is number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    throw new InvalidSitemapEntryError(
      `priority ${JSON.stringify(value)} is outside the protocol range 0.0–1.0`,
    );
  }
}

/** Every stored path carries its leading slash, so `/a` and `a` are one entry, not two. */
export function normalizePath(path: unknown): string {
  if (typeof path !== "string" || path.trim() === "") {
    throw new InvalidSitemapEntryError("path is required and must be a non-empty string");
  }

  // An absolute URL is left alone: the caller is overriding the base origin
  // deliberately, which a cross-origin alternate legitimately needs.
  if (/^https?:\/\//i.test(path)) return path;

  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Validates one entry and folds the builder's defaults into it. Defaults are
 * resolved HERE rather than at serialisation time so that `entries()` shows
 * what will actually be emitted — a diagnostic that reports something other
 * than the output is worse than none.
 */
export function normalizeEntry(
  entry: SitemapEntry,
  defaults: Pick<SitemapOptions, "changefreq" | "priority" | "lastmod">,
): ResolvedSitemapEntry {
  const path = normalizePath(entry.path);
  const changefreq = entry.changefreq ?? defaults.changefreq;
  const priority = entry.priority ?? defaults.priority;
  const lastmod = entry.lastmod ?? defaults.lastmod;

  if (changefreq !== undefined) assertChangeFreq(changefreq);
  if (priority !== undefined) assertPriority(priority);

  const alternates = entry.alternates?.map((alternate) => {
    if (typeof alternate?.hreflang !== "string" || alternate.hreflang.trim() === "") {
      throw new InvalidSitemapEntryError("alternate hreflang is required");
    }

    return { hreflang: alternate.hreflang, path: normalizePath(alternate.path) };
  });

  return {
    path,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    ...(entry.route !== undefined ? { route: entry.route } : {}),
    ...(lastmod !== undefined ? { lastmod: formatLastmod(lastmod) } : {}),
    ...(changefreq !== undefined ? { changefreq } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(alternates !== undefined ? { alternates } : {}),
  };
}
