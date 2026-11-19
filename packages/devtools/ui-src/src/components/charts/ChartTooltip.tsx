import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TooltipRow = {
  key: string;
  label: string;
  value: ReactNode;
  color: string;
  /** `rect` for column keys, `line` for line keys. */
  shape?: "rect" | "line";
};

/**
 * The hover and keyboard tooltip of a chart: one card with the bucket title,
 * one row per series (value first, then label, then its key) and the total.
 * Position it with `left` (a percentage of the plot) inside a `relative` box.
 */
export function ChartTooltip({
  id,
  title,
  rows,
  total,
  left,
}: {
  id: string;
  title: string;
  rows: TooltipRow[];
  /** Shown under the rows when given (stacked charts). */
  total?: ReactNode;
  /** The centre of the bucket, 0 to 100. */
  left: number;
}) {
  return (
    <div
      id={id}
      role="tooltip"
      className={cn(
        "pointer-events-none absolute top-1 z-10 min-w-40 max-w-64 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
        left > 60 ? "-translate-x-[calc(100%+0.75rem)]" : "translate-x-3",
      )}
      style={{ left: `${left}%` }}
    >
      <p className="mb-1 font-medium">{title}</p>
      <ul className="m-0 list-none space-y-0.5 p-0">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "inline-block shrink-0",
                row.shape === "line" ? "h-0.5 w-3" : "size-2.5 rounded-sm",
              )}
              style={{ background: row.color }}
            />
            <span className="font-semibold tabular-nums">{row.value}</span>
            <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
          </li>
        ))}
      </ul>
      {total !== undefined ? (
        <p className="mt-1 flex justify-between gap-3 border-t pt-1">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold tabular-nums">{total}</span>
        </p>
      ) : null}
    </div>
  );
}
