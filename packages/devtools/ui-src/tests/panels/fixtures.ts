import { DEVTOOLS_LATENCY_BUCKETS_MS, type DevtoolsHistogram } from "@contracts";

/** A histogram with `counts` in the first buckets, padded to the contract length. */
export function histogram(counts: number[], maxMs = 100): DevtoolsHistogram {
  const padded = [
    ...counts,
    ...new Array(DEVTOOLS_LATENCY_BUCKETS_MS.length + 1 - counts.length).fill(0),
  ];
  const count = padded.reduce((sum: number, value: number) => sum + value, 0);

  return { counts: padded, count, sumMs: count * 10, maxMs };
}
