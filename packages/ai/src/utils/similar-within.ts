/** Largest candidate page {@link similarWithin} asks a store for. */
export const MAX_SCOPED_CANDIDATES = 1_000;

/** How much each widened query grows the candidate page. */
const WIDEN_FACTOR = 4;

/**
 * Run a similarity query whose results are then narrowed to one scope
 * (a memory scope, a cache context, a RAG namespace) — and keep the
 * scope's own nearest entries reachable when other scopes crowd the top
 * of the ranking.
 *
 * The store ranks across every scope it holds, so its first page can be
 * filled by foreign entries. When fewer than `want` hits pass `accept`
 * and the store returned a full page (it has more to give), the query is
 * repeated with a page {@link WIDEN_FACTOR} times larger, up to
 * `maxTopK` (default {@link MAX_SCOPED_CANDIDATES}, never below `topK`).
 * When the first page is enough, this is exactly one query with the
 * caller's `topK` — the same call as before.
 *
 * Returns the accepted hits of the last query, in the store's order.
 *
 * Internal — not exported from the package barrel.
 *
 * @example
 * const hits = await similarWithin(
 *   (topK) => store.similar(vector, { topK, threshold }),
 *   (hit) => hit.value?.scope === scope,
 *   { topK: k * 5, want: k },
 * );
 */
export async function similarWithin<THit>(
  query: (topK: number) => Promise<THit[]>,
  accept: (hit: THit) => boolean,
  options: { topK: number; want: number; maxTopK?: number },
): Promise<THit[]> {
  const maxTopK = Math.max(options.topK, options.maxTopK ?? MAX_SCOPED_CANDIDATES);
  let topK = options.topK;

  for (;;) {
    const hits = await query(topK);
    const accepted = hits.filter(accept);

    if (accepted.length >= options.want || hits.length < topK || topK <= 0 || topK >= maxTopK) {
      return accepted;
    }

    topK = Math.min(topK * WIDEN_FACTOR, maxTopK);
  }
}
