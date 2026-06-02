import { version as esbuildVersion } from "esbuild";
import { warlockPath } from "../../utils";
import type { TranspileInit } from "./load-hook.js";
import { CACHE_EPOCH, computeFingerprint } from "./transpile-cache.js";

/**
 * esbuild `target` for the dev transform. Pinned to the same value the
 * production builder uses so dev and prod lower TC39 decorators (Cascade
 * leans on them) to identical helper output — a file transpiled in dev and
 * the same file built for prod must behave the same.
 */
const TRANSPILE_TARGET = "node22";

/**
 * Build the transpile payload shipped into the hook worker. Always
 * returned — esbuild transpile is unconditional (tsx is no longer in the
 * TypeScript path); persistence to `.warlock/transpile` is intrinsic.
 *
 * The fingerprint folds esbuild's version, the cache-format epoch and the
 * whole tsconfig `compilerOptions` blob (plus the target) so any change to
 * the transform contract invalidates every entry structurally — no sweep,
 * no stale output.
 *
 * @param compilerOptions - Raw tsconfig `compilerOptions` (handed to esbuild
 *   as `tsconfigRaw` and hashed wholesale into the fingerprint).
 * @param debugNames - `devServer.transpileCacheDebug` — cosmetic readable
 *   cache filenames. Default off.
 */
export function buildTranspileInit(
  compilerOptions: unknown,
  debugNames: boolean,
): TranspileInit {
  const fingerprint = computeFingerprint({
    esbuildVersion,
    cacheEpoch: CACHE_EPOCH,
    compilerOptions: { compilerOptions, target: TRANSPILE_TARGET },
  });

  return {
    cacheDir: warlockPath("transpile"),
    fingerprint,
    target: TRANSPILE_TARGET,
    tsconfigRaw: JSON.stringify({ compilerOptions: compilerOptions ?? {} }),
    debugNames,
  };
}
