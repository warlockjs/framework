import { createHash } from "node:crypto";
import { DEVTOOLS_LATENCY_BUCKETS_MS, type DevtoolsHistogram } from "../contracts";

/** An empty histogram over `DEVTOOLS_LATENCY_BUCKETS_MS`. */
export function createHistogram(): DevtoolsHistogram {
  return {
    counts: new Array<number>(DEVTOOLS_LATENCY_BUCKETS_MS.length + 1).fill(0),
    count: 0,
    sumMs: 0,
    maxMs: 0,
  };
}

/** The bucket index a duration falls in. */
export function bucketIndex(durationMs: number): number {
  for (let index = 0; index < DEVTOOLS_LATENCY_BUCKETS_MS.length; index++) {
    if (durationMs <= (DEVTOOLS_LATENCY_BUCKETS_MS[index] as number)) return index;
  }

  return DEVTOOLS_LATENCY_BUCKETS_MS.length;
}

/** Adds one duration to `histogram` in place. A negative or non-finite value counts as 0. */
export function recordDuration(histogram: DevtoolsHistogram, durationMs: number): void {
  const value = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const index = bucketIndex(value);

  histogram.counts[index] = (histogram.counts[index] ?? 0) + 1;
  histogram.count += 1;
  histogram.sumMs += value;

  if (value > histogram.maxMs) histogram.maxMs = value;
}

/** The sum of several histograms (exact: they share the bucket bounds). */
export function mergeHistograms(histograms: readonly DevtoolsHistogram[]): DevtoolsHistogram {
  const merged = createHistogram();

  for (const histogram of histograms) {
    for (let index = 0; index < merged.counts.length; index++) {
      merged.counts[index] = (merged.counts[index] ?? 0) + (histogram.counts[index] ?? 0);
    }

    merged.count += histogram.count;
    merged.sumMs += histogram.sumMs;

    if (histogram.maxMs > merged.maxMs) merged.maxMs = histogram.maxMs;
  }

  return merged;
}

/**
 * The `q` quantile (0–1) of a histogram: the upper bound of the bucket that
 * holds it, capped at the largest value seen. 0 for an empty histogram.
 */
export function histogramQuantile(histogram: DevtoolsHistogram, q: number): number {
  if (histogram.count === 0) return 0;

  const rank = Math.max(1, Math.ceil(Math.min(Math.max(q, 0), 1) * histogram.count));
  let seen = 0;

  for (let index = 0; index < histogram.counts.length; index++) {
    seen += histogram.counts[index] ?? 0;

    if (seen >= rank) {
      const bound = DEVTOOLS_LATENCY_BUCKETS_MS[index];

      return bound === undefined ? histogram.maxMs : Math.min(bound, histogram.maxMs);
    }
  }

  return histogram.maxMs;
}

/** The mean duration, 0 for an empty histogram. */
export function histogramMean(histogram: DevtoolsHistogram): number {
  return histogram.count === 0 ? 0 : histogram.sumMs / histogram.count;
}

/** The first 16 hex characters of SHA-256: the id of a query shape or an error fingerprint. */
export function shortId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
