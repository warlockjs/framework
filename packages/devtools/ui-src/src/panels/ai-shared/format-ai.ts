import { DASH } from "@/components/ui/panel-kit";

export { bucketLabel, bucketTitle } from "@/components/charts/buckets";

/** Estimated money: `$12.34` from one dollar up, four decimals below, `$0` for zero. */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH;
  if (value === 0) return "$0";

  return value >= 1
    ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${value.toFixed(4)}`;
}

/** Token counts in a compact form: `842`, `12.3k`, `4.1M`. */
export function formatTokens(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH;

  const scaled = (divisor: number, unit: string) => {
    const shown = value / divisor;

    return `${shown >= 100 ? Math.round(shown) : shown.toFixed(1).replace(/\.0$/, "")}${unit}`;
  };

  if (value >= 1_000_000_000) return scaled(1_000_000_000, "B");
  if (value >= 1_000_000) return scaled(1_000_000, "M");
  if (value >= 1000) return scaled(1000, "k");

  return String(Math.round(value));
}

/** A ratio from 0 to 1 as a percent: `0%`, `<0.1%`, `4.2%`, `37%` (a non-zero ratio never reads as 0%). */
export function formatRatio(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH;

  const percent = value * 100;

  if (percent === 0) return "0%";
  if (percent > 0 && percent < 0.05) return "<0.1%";
  if (percent < 10) return `${percent.toFixed(1).replace(/\.0$/, "")}%`;

  return `${Math.round(percent)}%`;
}

/** A model latency (a histogram bucket bound): `850 ms`, `2.5 s`, `1.5 min`. */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")} s`;

  return `${(ms / 60_000).toFixed(1).replace(/\.0$/, "")} min`;
}

/** The wording after "vs" in a KPI change: `previous 7 days`. */
export function previousLabel(range: { preset: string; from: number; to: number }): string {
  if (range.preset === "24h") return "previous 24 hours";
  if (range.preset === "7d") return "previous 7 days";
  if (range.preset === "30d") return "previous 30 days";

  const hours = Math.round((range.to - range.from) / 3_600_000);

  return hours <= 48 ? `previous ${hours} hours` : `previous ${Math.round(hours / 24)} days`;
}
