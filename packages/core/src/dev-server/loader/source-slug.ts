/**
 * Human-readable label for a cached transpile file, derived from the last
 * three path segments of the source file.
 *
 * Purely cosmetic: it rides in front of the content hash in the cache
 * filename so `ls .warlock/transpile/<shard>/` is browsable when debugging.
 * It is **never** used as a cache key, module URL, or source-map
 * `sourcefile` — correctness still rests entirely on the content hash, so
 * the slug is allowed to be lossy (sanitised, capped).
 *
 * @example
 *   sourceSlug("D:/proj/src/app/vectors/utils/locales.ts")
 *   // → "vectors-utils-locales"
 */
export function sourceSlug(absolutePath: string): string {
  const noExt = absolutePath.replace(/\\/g, "/").replace(/\.[cm]?[jt]sx?$/, "");

  const slug = noExt
    .split("/")
    .filter(Boolean)
    .slice(-3)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // The hash guarantees uniqueness; the slug is just a label, so capping it
  // is safe and keeps total path length sane on deep trees / Windows.
  return slug.slice(0, 60) || "src";
}
