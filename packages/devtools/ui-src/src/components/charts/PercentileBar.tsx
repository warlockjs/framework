import { formatMs } from "@/components/ui/panel-kit";

/** p50 / p95 / max on one scale, so the spread reads at a glance. */
export function PercentileBar({ p50, p95, max }: { p50: number; p95: number; max: number }) {
  const top = Math.max(max, p95, p50, 1);
  const pct = (value: number) => `${Math.min(100, (value / top) * 100)}%`;

  return (
    <div
      role="img"
      aria-label={`p50 ${formatMs(p50)}, p95 ${formatMs(p95)}, max ${formatMs(max)}`}
      className="relative h-3 min-w-24 rounded-sm bg-muted"
    >
      <span className="absolute inset-y-0 left-0 rounded-sm opacity-40" style={{ width: pct(max), background: "var(--chart-4)" }} />
      <span className="absolute inset-y-0 left-0 rounded-sm opacity-70" style={{ width: pct(p95), background: "var(--chart-1)" }} />
      <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: pct(p50), background: "var(--chart-2)" }} />
    </div>
  );
}
