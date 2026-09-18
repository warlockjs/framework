const SAFE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Canonical form used to detect a case collision before it reaches the
 * filesystem: `en-US` and `en-us` would produce the same file on a
 * case-insensitive filesystem and silently overwrite one another.
 *
 * The key reaches the filename and nothing else — it is validated as a
 * filename fragment, not interpreted as a locale or anything else.
 */
export function canonicalizeSourceKey(key: string): string {
  if (typeof key !== "string" || !SAFE_KEY_PATTERN.test(key)) {
    throw new RangeError(
      `sitemap source key ${JSON.stringify(key)} must be a non-empty filename fragment ` +
        `(letters, digits, "-", "_").`,
    );
  }

  return key.toLowerCase();
}

/**
 * Stable, zero-padded, ordinal from shard one. A group that later crosses a
 * ceiling GAINS a file; it never renames the first one, so a crawler that has
 * already indexed `sitemap-en-0001.xml` never loses it because the site grew.
 */
export function shardFileName(
  filePrefix: string,
  key: string | undefined,
  ordinal: number,
  gzip: boolean,
): string {
  const paddedOrdinal = String(ordinal).padStart(4, "0");
  const base =
    key !== undefined ? `${filePrefix}-${key}-${paddedOrdinal}` : `${filePrefix}-${paddedOrdinal}`;

  return gzip ? `${base}.xml.gz` : `${base}.xml`;
}
