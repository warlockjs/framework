import { cn } from "@/lib/utils";

export type LegendItem = { key: string; label: string; color: string };

/** The legend of a chart with two or more series: a key per series, in text colour, never the series colour. */
export function ChartLegend({
  items,
  shape = "rect",
}: {
  items: LegendItem[];
  shape?: "rect" | "line";
}) {
  if (items.length < 2) return null;

  return (
    <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs">
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden
            className={cn("inline-block", shape === "line" ? "h-0.5 w-3" : "size-2.5 rounded-sm")}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
