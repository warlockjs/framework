/**
 * The three vector operations the RAG pipeline needs, expressed as a thin
 * structural narrowing of the `@warlock.js/cache` `CacheDriver` surface
 * (`set({ vector })` + `similar()` + `removeNamespace()`).
 *
 * This is NOT a new storage engine — v1 has exactly one implementation,
 * {@link cacheVectorStore}, which adapts any `CacheDriver`. The contract
 * exists so a future non-cache backend can be swapped in without touching
 * the pipeline. Cache stays embedding-agnostic; the RAG vocabulary
 * (`upsert` / `query`) lives here, in the rag feature.
 */
export interface VectorStore {
  /**
   * Index a value under `key` with its embedding vector. Optional `tags`
   * are stored alongside the entry so `query({ tags })` can restrict the
   * candidate set to a subset of sources.
   */
  upsert(key: string, value: unknown, vector: number[], tags?: string[]): Promise<void>;
  /**
   * Cosine-nearest entries to `vector` clearing `threshold`, capped at
   * `topK`, optionally restricted to entries carrying one of `tags`.
   */
  query<T>(
    vector: number[],
    options: {
      topK: number;
      threshold?: number;
      tags?: string[];
      /**
       * Keep only entries this returns `true` for, applied before `topK`
       * truncation so a scoped recall is one query. A store that cannot
       * filter before ranking may ignore it; the caller re-checks the hits.
       */
      filter?: (hit: { key: string; value: any }) => boolean;
    },
  ): Promise<{ key: string; value: T; score: number }[]>;
  /**
   * Drop every entry written under `namespace`, by key prefix. This also
   * drops the entries of a nested namespace (`kb.acme` reaches
   * `kb.acme.private`); use {@link VectorStore.remove} when only the exact
   * namespace's entries should go.
   */
  removeNamespace(namespace: string): Promise<void>;
  /**
   * Drop the entry stored under `key`. Optional: when present, `rag.clear()`
   * uses it to delete only its own namespace's chunks.
   */
  remove?(key: string): Promise<void>;
  /**
   * Every live entry stored under `namespace` (the namespace key and its
   * `<namespace>.*` keys, nested namespaces included). Optional: when present
   * together with {@link VectorStore.remove}, `rag.clear()` deletes its own
   * chunks from this list instead of sweeping with similarity queries.
   */
  list?<T>(namespace: string): Promise<{ key: string; value: T }[]>;
}
