import type { ChunkCallback } from "../contracts/query-builder.contract";
import { toSafeCount } from "./pagination-limits";

/**
 * Keyset paging for `chunk()`.
 *
 * Paging with skip/OFFSET makes the database walk and discard every earlier
 * row for each chunk (chunk N reads N × size rows), and rows inserted or
 * removed between chunks shift the window. When the query is ordered by its
 * unique key, or not ordered at all, each chunk can instead continue from
 * the last key seen: `where key > last ORDER BY key LIMIT size`.
 */

/** How `chunk()` pages a query by its unique key. */
export type KeysetPlan = {
  /** The unique, never-null key the rows are ordered by. */
  key: string;
  /** Order of the key. */
  direction: "asc" | "desc";
  /** True when the query already orders by the key (no extra `orderBy` needed). */
  sorted: boolean;
};

/** One page request: after a key (keyset) or from an offset. */
export type ChunkPage = { after?: unknown; offset?: number };

/**
 * Read the key of a fetched row: a model instance through `get()`, a lean
 * row as a property.
 */
export function readRowKey(row: unknown, key: string): unknown {
  if (row === null || typeof row !== "object") return undefined;

  const getter = (row as { get?: unknown }).get;

  return typeof getter === "function"
    ? (getter as (field: string) => unknown).call(row, key)
    : (row as Record<string, unknown>)[key];
}

/**
 * Run `callback` over the query's rows, `size` at a time.
 *
 * With a plan, each page continues after the last key seen. If a row comes
 * back without its key (a projection that drops it), paging continues by
 * offset in the same key order. Without a plan, every page is read by offset.
 *
 * @param size - Rows per chunk (a whole number of at least 1)
 * @param callback - Called with each chunk; returning `false` stops
 * @param plan - The keyset plan, or undefined for offset paging
 * @param fetchPage - Reads one page of at most `size` rows
 */
export async function runChunks<T>(
  size: number,
  callback: ChunkCallback<T>,
  plan: KeysetPlan | undefined,
  fetchPage: (page: ChunkPage, size: number) => Promise<T[]>,
): Promise<void> {
  const chunkSize = toSafeCount(size, "chunk(): size", 1);
  let chunkIndex = 0;
  let processed = 0;
  let after: unknown;
  let byKey = plan !== undefined;

  while (true) {
    const rows = await fetchPage(byKey ? { after } : { offset: processed }, chunkSize);

    if (rows.length === 0) break;

    if ((await callback(rows, chunkIndex)) === false) break;

    if (rows.length !== chunkSize) break;

    processed += rows.length;
    chunkIndex++;

    if (byKey && plan) {
      const last = readRowKey(rows[rows.length - 1], plan.key);

      if (last === undefined || last === null) {
        byKey = false;
      } else {
        after = last;
      }
    }
  }
}
