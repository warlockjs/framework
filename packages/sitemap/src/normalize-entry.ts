import { InvalidSitemapEntryError } from "./errors";
import { formatLastmod } from "./lastmod";
import type {
  ChangeFreq,
  ResolvedSitemapEntry,
  SitemapEntry,
  SitemapImage,
  SitemapOptions,
} from "./types";

const CHANGE_FREQS: readonly ChangeFreq[] = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
];
const MAX_IMAGES_PER_URL = 1_000;

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

/** Characters a URL may carry as they are (RFC 3986 unreserved and reserved, plus `%`). */
const URL_UNSAFE_CHARACTER = /[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/gu;
/** A `%` that does not start a percent-escape. */
const STRAY_PERCENT = /%(?![0-9A-Fa-f]{2})/g;

function encodeCharacter(character: string): string {
  try {
    return encodeURIComponent(character);
  } catch {
    // A lone surrogate has no UTF-8 form; it becomes U+FFFD, like a decoder would show it.
    return encodeURIComponent("\uFFFD");
  }
}

/**
 * Percent-encodes every character a sitemap URL may not carry raw: spaces,
 * non-ASCII text (as UTF-8), and control characters, which would otherwise
 * make the whole XML file unparseable. Existing `%XX` escapes are kept, so an
 * already-encoded path is unchanged.
 */
function encodeUrlCharacters(value: string): string {
  return value.replace(STRAY_PERCENT, "%25").replace(URL_UNSAFE_CHARACTER, encodeCharacter);
}

/**
 * Every stored path carries its leading slash, so `/a` and `a` are one entry,
 * not two, and is percent-encoded so a path built from user data (a slug with
 * a space or a control character) can never break the file.
 */
export function normalizePath(path: unknown): string {
  if (typeof path !== "string" || path.trim() === "") {
    throw new InvalidSitemapEntryError("path is required and must be a non-empty string");
  }

  const encoded = encodeUrlCharacters(path);

  // An absolute URL keeps its own origin: the caller is overriding the base
  // origin deliberately, which a cross-origin alternate legitimately needs.
  if (/^https?:\/\//i.test(encoded)) return encoded;

  return encoded.startsWith("/") ? encoded : `/${encoded}`;
}

/**
 * Validates one entry and folds the builder's defaults into it. Defaults are
 * resolved HERE rather than at serialisation time so that `entries()` shows
 * what will actually be emitted — a diagnostic that reports something other
 * than the output is worse than none.
 */
export function normalizeEntry(
  entry: SitemapEntry,
  defaults: Pick<SitemapOptions, "changefreq" | "priority" | "lastmod" | "onImageLimitExceeded">,
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
  if (entry.images !== undefined && !Array.isArray(entry.images)) {
    throw new InvalidSitemapEntryError("images must be an array");
  }
  const images = entry.images?.slice(0, MAX_IMAGES_PER_URL).map((image): SitemapImage => {
    if (typeof image?.loc !== "string" || image.loc.trim() === "") {
      throw new InvalidSitemapEntryError("image loc is required");
    }

    let url: URL;
    try {
      url = new URL(image.loc);
    } catch {
      throw new InvalidSitemapEntryError("image loc must be an absolute HTTP(S) URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new InvalidSitemapEntryError("image loc must be an absolute HTTP(S) URL");
    }

    return { loc: image.loc };
  });
  if ((entry.images?.length ?? 0) > MAX_IMAGES_PER_URL) {
    defaults.onImageLimitExceeded?.({
      ...(entry.route === undefined ? {} : { route: entry.route }),
      dropped: entry.images!.length - MAX_IMAGES_PER_URL,
    });
  }

  return {
    path,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    ...(entry.route !== undefined ? { route: entry.route } : {}),
    ...(lastmod !== undefined ? { lastmod: formatLastmod(lastmod) } : {}),
    ...(changefreq !== undefined ? { changefreq } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(alternates !== undefined ? { alternates } : {}),
    ...(images !== undefined ? { images } : {}),
  };
}
