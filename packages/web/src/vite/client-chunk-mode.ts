/**
 * How the client bundle is split into files.
 *
 * - `"split"` — the default: a `vendor-react` chunk, the hydration entry, and
 *   one lazy chunk per page plus whatever pages share.
 * - `"merged"` — the same lazy page loading, with the many small shared chunks
 *   packed together (Rolldown group `minSize` / `maxSize`), so there are far
 *   fewer files.
 * - `"single"` — one JavaScript entry and one stylesheet; dynamic imports are
 *   inlined. For a desktop or offline app that serves from local disk.
 */
export type ClientChunkMode = "split" | "merged" | "single";

export const CLIENT_CHUNK_MODES: readonly ClientChunkMode[] = ["split", "merged", "single"];

/** Validate a configured chunk mode; `undefined` means `"split"`. */
export function resolveClientChunkMode(value: unknown): ClientChunkMode {
  if (value === undefined) return "split";

  if (typeof value === "string" && (CLIENT_CHUNK_MODES as readonly string[]).includes(value)) {
    return value as ClientChunkMode;
  }

  throw new TypeError(
    `Invalid web build option chunks: ${JSON.stringify(value)}. Use "split", "merged" or "single".`,
  );
}
