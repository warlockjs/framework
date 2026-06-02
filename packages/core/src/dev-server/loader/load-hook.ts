import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sourceSlug } from "./source-slug.js";
import { cacheKey, TranspileCache } from "./transpile-cache.js";

type LoadContext = {
  format?: string;
  importAttributes?: Record<string, string>;
};

type LoadResult = {
  format: string;
  source: string | Buffer;
  shortCircuit?: boolean;
};

type NextLoad = (url: string, context?: LoadContext) => Promise<LoadResult>;

/**
 * Everything the transpile path needs, computed once on the main thread and
 * shipped into the hook worker via `initialize()`. Always present — esbuild
 * transpile is unconditional now (tsx is no longer in the TS path).
 */
export type TranspileInit = {
  /** Absolute `.warlock/transpile` directory. */
  cacheDir: string;
  /** Source-content key salt: esbuild version + epoch + tsconfig blob. */
  fingerprint: string;
  /** esbuild `target` (e.g. `"node22"` — must match the prod builder). */
  target: string;
  /** JSON string of `{ compilerOptions }` handed to esbuild as tsconfigRaw. */
  tsconfigRaw: string;
  /**
   * Debug-only: name cache files `<slug>.<hash>.js` and append a trailing
   * `// @source <path>` marker so entries are eyeball-identifiable. Off by
   * default (opaque `<hash>.js`). Cosmetic — never affects keys or lookup.
   */
  debugNames: boolean;
};

const VERSION_QUERY = /\?v=\d+$/;
const TS_FILE = /\.(ts|tsx|mts|cts)$/;

let transpile: TranspileInit;
let cache: TranspileCache;

/**
 * Called once from the hook worker's `initialize()`. Wires the persisted
 * transpile cache and runs one opportunistic GC pass at boot — cheap, off
 * the hot path, single directory scan.
 */
export function configureTranspile(init: TranspileInit): void {
  transpile = init;
  cache = new TranspileCache(init.cacheDir);

  // Boot-time eviction so the cache can't grow unbounded across weeks of
  // dev. Bounds are generous; correctness never depends on GC (content
  // hashing already guarantees that) — this is purely disk hygiene.
  cache.gc({
    maxBytes: 256 * 1024 * 1024,
    maxAgeMs: 14 * 24 * 60 * 60 * 1000,
  });
}

/**
 * ESM loader `load()` hook.
 *
 * Owns the transpile for **every** TypeScript file — project `src/`,
 * `@warlock.js/*` framework source, and `warlock.config.ts` alike. There
 * is no tsx in the TypeScript path any more: we read the source, key it by
 * a content hash + options fingerprint, serve the cached JS on a hit, and
 * otherwise transform it with esbuild directly and persist. Non-TypeScript
 * URLs (npm `.js`/`.cjs`/`.mjs`, `node:` builtins, JSON) are not ours —
 * they fall through to the next loader (Node's default).
 *
 * The `?v=<N>` query drives Node's module identity (HMR) for `src/` files
 * and is **never** part of the cache key — the cache is keyed purely by
 * source content, so the two mechanisms are fully orthogonal. Framework
 * and config `.ts` carry no `?v` (no HMR) but are transpiled and cached
 * exactly the same way.
 *
 * The source map esbuild emits is inline base64 with `sourcefile` set to
 * the clean absolute `.ts` path, so V8 (run with source maps enabled)
 * reports stack frames at the original TypeScript location.
 *
 * @example
 * // load("file:///src/user.model.ts?v=3")  → esbuild transpile + cache
 * // load("file:///@warlock.js/core/src/x.ts") → esbuild transpile + cache
 * // load("file:///node_modules/ms/index.js")  → nextLoad (Node default)
 */
export async function load(
  url: string,
  context: LoadContext,
  nextLoad: NextLoad,
): Promise<LoadResult> {
  const cleanUrl = url.replace(VERSION_QUERY, "");

  // Not TypeScript → not ours. npm packages, node: builtins, JSON, etc.
  if (!TS_FILE.test(cleanUrl)) {
    return nextLoad(url, context);
  }

  const absolutePath = fileURLToPath(cleanUrl);
  const source = readFileSync(absolutePath, "utf8");
  const key = cacheKey(source, transpile.fingerprint);

  // Cosmetic filename label; undefined keeps opaque <hash>.js names.
  const label = transpile.debugNames ? sourceSlug(absolutePath) : undefined;

  const hit = cache.get(key, label);
  if (hit) {
    return { format: "module", source: hit.code, shortCircuit: true };
  }

  const loader = absolutePath.endsWith(".tsx") ? "tsx" : "ts";

  const result = transformSync(source, {
    loader,
    format: "esm",
    target: transpile.target,
    sourcefile: absolutePath,
    // Inline base64 map, self-contained (sourcesContent on by default), so
    // it survives the ?v=N URL with no extra resolution step.
    sourcemap: "inline",
    tsconfigRaw: transpile.tsconfigRaw,
  });

  // result.code already carries the inline //# sourceMappingURL. The
  // marker goes AFTER that line: a trailing comment can't shift earlier
  // generated lines, so the inline map (and therefore stack-frame line
  // numbers) stays exact. A leading marker would desync it by one line.
  const code = label
    ? `${result.code}\n// @source ${absolutePath}\n`
    : result.code;

  cache.put(key, { code, map: "" }, label);

  return { format: "module", source: code, shortCircuit: true };
}
