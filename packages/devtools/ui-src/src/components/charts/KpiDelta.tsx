import { cn } from "@/lib/utils";

/** The text of a change: `▲ 12% vs previous 7 days`, `No change`, or `New` when the previous value was zero. */
export function deltaText(current: number, previous: number, against: string): string {
  if (current === previous) return "No change";
  if (previous === 0) return "New";

  const percent = Math.abs(((current - previous) / previous) * 100);
  const shown =
    percent < 1
      ? "<1"
      : percent < 10
        ? percent.toFixed(1).replace(/\.0$/, "")
        : Math.round(percent);

  return `${current > previous ? "▲" : "▼"} ${shown}% vs ${against}`;
}

/**
 * The change of a figure against the previous period. Arrow, sign and words
 * always show, so the meaning never rests on colour; only a rising figure that
 * is bad (error rate, latency) takes the warning tone. When the previous
 * period is older than the kept history (`previousComplete: false`) it says
 * "No earlier data" instead of comparing against a period that was removed.
 */
export function KpiDelta({
  current,
  previous,
  against,
  risingIsBad,
  previousComplete = true,
}: {
  current: number;
  previous: number;
  /** "previous 7 days". */
  against: string;
  risingIsBad?: boolean;
  /** `false` when part of the previous period is past the retention cut-off. @default true */
  previousComplete?: boolean;
}) {
  if (!previousComplete) {
    return <span className="text-xs text-muted-foreground">No earlier data</span>;
  }

  const bad = Boolean(risingIsBad) && current > previous;

  return (
    <span className={cn("text-xs tabular-nums", bad ? "text-warning" : "text-muted-foreground")}>
      {deltaText(current, previous, against)}
    </span>
  );
}
