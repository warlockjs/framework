import { DEVTOOLS_AI_LATENCY_BUCKETS_MS } from "../../production/contracts";

/**
 * Latency histograms over `DEVTOOLS_AI_LATENCY_BUCKETS_MS`, stored as plain
 * count arrays in the rollups (one more count than bounds).
 */

const BUCKETS = DEVTOOLS_AI_LATENCY_BUCKETS_MS;

/** `DEVTOOLS_AI_LATENCY_BUCKETS_MS.length + 1` zeros. */
export function emptyAiLatency(): number[] {
  return new Array<number>(BUCKETS.length + 1).fill(0);
}

/** The bucket index of a duration; a negative or non-finite value counts as 0. */
export function aiLatencyBucket(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 0;

  const index = BUCKETS.findIndex((bound) => durationMs <= bound);

  return index === -1 ? BUCKETS.length : index;
}

/** Adds `source` into `target` in place (same length). */
export function addAiLatency(target: number[], source: readonly number[]): void {
  for (let index = 0; index < target.length; index++) {
    target[index] = (target[index] ?? 0) + (source[index] ?? 0);
  }
}

/**
 * The `q` quantile (0–1): the upper bound of the bucket that holds it, or the
 * last bound for the overflow bucket. `null` for an empty histogram.
 */
export function aiLatencyQuantile(counts: readonly number[], q: number): number | null {
  let total = 0;

  for (const count of counts) total += count;

  if (total <= 0) return null;

  const target = Math.max(1, Math.ceil(Math.min(1, Math.max(0, q)) * total));
  let seen = 0;

  for (let index = 0; index < counts.length; index++) {
    seen += counts[index] ?? 0;

    if (seen >= target) return BUCKETS[Math.min(index, BUCKETS.length - 1)] ?? null;
  }

  return BUCKETS[BUCKETS.length - 1] ?? null;
}
