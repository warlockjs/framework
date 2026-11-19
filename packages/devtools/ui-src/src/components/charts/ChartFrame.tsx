import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The card around a chart: title, legend, a "Table" toggle that swaps the plot
 * for the same data as a table, and reduced opacity while a refetch runs.
 */
export function ChartFrame({
  title,
  description,
  legend,
  table,
  loading,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  legend?: ReactNode;
  /** The same data as a `<table>`; the toggle shows only when given. */
  table?: ReactNode;
  /** True while the page refetches with the previous data still shown. */
  loading?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();

  return (
    <section
      aria-labelledby={id}
      className={cn(
        "min-w-0 rounded-xl border bg-card p-3.5 transition-opacity",
        loading && "opacity-60",
        className,
      )}
    >
      <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={id} className="text-sm font-semibold">
            {title}
          </h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {table ? (
          <button
            type="button"
            aria-pressed={showTable}
            onClick={() => setShowTable((value) => !value)}
            className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-pressed:bg-muted aria-pressed:text-foreground"
          >
            Table
          </button>
        ) : null}
      </header>
      {legend ? <div className="mb-2">{legend}</div> : null}
      {showTable && table ? <div className="max-h-80 overflow-auto">{table}</div> : children}
    </section>
  );
}
