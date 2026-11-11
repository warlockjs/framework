import fs from "node:fs";
import { parseEntityTag } from "./conditional-request";

/**
 * Stat a path that should be a regular file: its stats, or `undefined` when
 * it is missing, unreadable or not a file. One system call where an
 * existence check followed by a stat took two.
 *
 * @internal
 */
export async function statFile(filePath: string): Promise<fs.Stats | undefined> {
  try {
    const stats = await fs.promises.stat(filePath);

    return stats.isFile() ? stats : undefined;
  } catch {
    return undefined;
  }
}

/** An inclusive byte range within a file. */
export type ByteRange = { start: number; end: number };

export type ResolveByteRangeInput = {
  method: string;
  /** The `Range` request header. */
  range: unknown;
  /** The `If-Range` request header. */
  ifRange: unknown;
  /** The file's current (strong) entity tag. */
  etag: string;
  lastModified: Date;
  /** File size in bytes. */
  size: number;
};

/**
 * Whether `If-Range` still names the current file (RFC 9110 §13.1.5): a
 * strong entity tag equal to the current one, or an HTTP date equal to the
 * last modification time (second precision). Absent means "yes".
 */
function ifRangeHolds(ifRange: unknown, etag: string, lastModified: Date): boolean {
  if (ifRange === undefined || ifRange === null || ifRange === "") return true;

  if (typeof ifRange !== "string") return false;

  const value = ifRange.trim();

  if (value.startsWith('"') || value.startsWith("W/")) {
    const tag = parseEntityTag(value);
    const current = parseEntityTag(etag);

    return (
      tag !== undefined &&
      current !== undefined &&
      !tag.weak &&
      !current.weak &&
      tag.opaque === current.opaque
    );
  }

  const date = Date.parse(value);

  return (
    !Number.isNaN(date) && Math.floor(date / 1000) === Math.floor(lastModified.getTime() / 1000)
  );
}

/**
 * Resolve a single-range `Range: bytes=…` request against a file:
 *
 * - `undefined` — send the whole file (no `Range`, not GET/HEAD, another
 *   unit, several ranges, a malformed header, or a stale `If-Range`);
 * - a {@link ByteRange} — answer 206 with these bytes;
 * - `"unsatisfiable"` — answer 416 (the range starts past the end).
 *
 * @internal
 */
export function resolveByteRange(
  input: ResolveByteRangeInput,
): ByteRange | "unsatisfiable" | undefined {
  const method = input.method.toUpperCase();

  if (method !== "GET" && method !== "HEAD") return undefined;

  if (typeof input.range !== "string") return undefined;

  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(input.range);

  // Another unit, several ranges, or garbage: the full representation is a
  // valid answer to all of them.
  if (!match) return undefined;

  if (!ifRangeHolds(input.ifRange, input.etag, input.lastModified)) return undefined;

  const [, rawStart = "", rawEnd = ""] = match;
  const { size } = input;

  if (rawStart === "" && rawEnd === "") return undefined;

  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const length = Number(rawEnd);

    if (length === 0) return "unsatisfiable";

    if (size === 0) return "unsatisfiable";

    return { start: Math.max(size - length, 0), end: size - 1 };
  }

  const start = Number(rawStart);

  if (start >= size) return "unsatisfiable";

  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);

  if (end < start) return undefined;

  return { start, end };
}
