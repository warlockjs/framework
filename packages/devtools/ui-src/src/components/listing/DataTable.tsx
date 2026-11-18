import type { KeyboardEvent, ReactNode } from "react";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** A table inside a rounded card; wide tables scroll inside the card, never the page. */
export function TableCard({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <Table aria-label={label}>{children}</Table>
    </div>
  );
}

/** The header cell look shared by every listing. */
export const HEAD = "h-9 bg-muted/40 text-xs font-medium text-muted-foreground";

/** A numeric cell: right-aligned, tabular figures. */
export const NUM_CELL = "text-right tabular-nums";

/** Props that make a table row a keyboard-reachable button that opens something. */
export function rowOpen(onOpen: () => void) {
  return {
    tabIndex: 0,
    className:
      "cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
    onClick: onOpen,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    },
  };
}

/** A figure with a thin bar under it that shows its size against the largest in the list. */
export function DurationBar({
  ms,
  max,
  text,
  tone = "bg-brand",
}: {
  ms: number | null | undefined;
  max: number;
  text: string;
  tone?: string;
}) {
  const width = ms && max > 0 ? Math.max(3, Math.min(100, (ms / max) * 100)) : 0;

  return (
    <div className="ml-auto flex w-24 flex-col items-end gap-1">
      <span className="tabular-nums">{text}</span>
      <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

/** The `p`th percentile of a list of numbers (nearest rank), or `null` when it is empty. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);

  return (
    sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))] ??
    null
  );
}
