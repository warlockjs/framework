import { DEVTOOLS_LATENCY_BUCKETS_MS, type DevtoolsHistogram } from "@contracts";

function bucketLabel(index: number): string {
  const bounds = DEVTOOLS_LATENCY_BUCKETS_MS;
  const upper = bounds[index];

  if (upper === undefined) return `> ${bounds.at(-1)} ms`;

  const lower = index === 0 ? 0 : bounds[index - 1];

  return `${lower}–${upper} ms`;
}

/**
 * Latency histogram as horizontal bars, one per fixed bucket (empty leading
 * and trailing buckets are left out).
 */
export function HistogramBars({ histogram }: { histogram: DevtoolsHistogram }) {
  const counts = histogram.counts;
  const first = counts.findIndex((count) => count > 0);

  if (first === -1) return <p className="text-xs text-muted-foreground">No timings recorded yet.</p>;

  const last = counts.length - 1 - [...counts].reverse().findIndex((count) => count > 0);
  const peak = Math.max(...counts, 1);

  return (
    <ul className="m-0 list-none space-y-1 p-0" aria-label="Latency histogram">
      {counts.slice(first, last + 1).map((count, offset) => {
        const index = first + offset;

        return (
          <li key={index} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2 text-xs">
            <span className="text-muted-foreground tabular-nums">{bucketLabel(index)}</span>
            <span className="h-3 rounded-sm bg-muted">
              <span
                className="block h-3 rounded-sm"
                style={{ width: `${(count / peak) * 100}%`, background: "var(--chart-2)" }}
              />
            </span>
            <span className="text-right tabular-nums">{count.toLocaleString("en-US")}</span>
          </li>
        );
      })}
    </ul>
  );
}
