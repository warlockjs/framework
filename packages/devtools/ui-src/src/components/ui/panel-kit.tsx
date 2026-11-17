import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Small building blocks the built-in tabs share: the number and time formatters
 * and the form controls the filters use. The loading, empty and error states
 * live in `@/components/common`.
 */

/** A value that is not known, shown instead of a blank. */
export const DASH = "—";

export function formatNumber(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? DASH : value.toLocaleString("en-US");
}

/** Milliseconds with a fitting unit: `0.4 ms`, `12 ms`, `1.25 s`. */
export function formatMs(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)} s`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  if (value >= 100) return `${Math.round(value)} ms`;
  if (value >= 10) return `${value.toFixed(1)} ms`;
  return `${value.toFixed(value < 1 ? 2 : 1)} ms`;
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DASH;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? size : size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return value == null || Number.isNaN(value) ? DASH : `${value.toFixed(digits)} %`;
}

export function formatCost(value: number | null | undefined): string {
  return value == null ? "unpriced" : `$${value.toFixed(6)} USD`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} h`;

  return `${(seconds / 86_400).toFixed(1)} d`;
}

/** `3 s ago`, `5 min ago`, or `in 2 min`, from an epoch ms value. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.round((now - at) / 1000);
  const abs = Math.abs(seconds);
  const text = abs < 5 ? "just now" : formatDuration(abs);

  if (abs < 5) return text;

  return seconds >= 0 ? `${text} ago` : `in ${text}`;
}

/** A time shown relative, with the absolute time on hover. */
export function Time({ at, className }: { at: number | null | undefined; className?: string }) {
  if (at == null) return <span className={className}>{DASH}</span>;

  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={new Date(at).toLocaleString()}
      className={className}
    >
      {relativeTime(at)}
    </time>
  );
}

/** A clock time, for log rows. */
export function clockTime(at: number | null | undefined): string {
  return at == null ? DASH : new Date(at).toLocaleTimeString();
}

/** A title row with controls on the right. */
export function PanelHeader({
  title,
  children,
  note,
}: {
  title: string;
  children?: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 mb-2 text-sm font-semibold">{children}</h3>;
}

/** Monospace text that wraps: SQL, query shapes, stacks, JSON. */
export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-80 overflow-auto rounded-md bg-muted p-2 font-mono text-xs break-words whitespace-pre-wrap",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function Json({ value }: { value: unknown }) {
  return <Code>{JSON.stringify(value, null, 2) ?? "undefined"}</Code>;
}

const fieldClass =
  "h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function TextField({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function SelectField({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldClass, className)} {...props} />;
}

/** A pressed/unpressed button group member (HTML | Text, Scalar | Swagger). */
export function ToggleButton({
  active,
  children,
  ...props
}: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      {...props}
    >
      {children}
    </Button>
  );
}

/** A selectable list row (button) used by the list/detail tabs. */
export function RowButton({
  selected,
  className,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "block w-full rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        selected && "border-ring bg-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Status-code colour classes. */
export function statusTone(status: number | null | undefined): string {
  if (status == null) return "text-muted-foreground";
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-amber-600 dark:text-amber-400";
  if (status >= 300) return "text-sky-600 dark:text-sky-400";

  return "text-emerald-600 dark:text-emerald-400";
}

export function levelTone(level: string): string {
  switch (level) {
    case "error":
      return "text-destructive";
    case "warn":
      return "text-amber-600 dark:text-amber-400";
    case "success":
      return "text-emerald-600 dark:text-emerald-400";
    case "debug":
      return "text-muted-foreground";
    default:
      return "text-sky-600 dark:text-sky-400";
  }
}

/** A numeric table cell: right-aligned, tabular figures. */
export const NUM = "text-right tabular-nums";

/** Maps an instance id to its label using a list of instances. */
export function instanceLabel(
  id: string | null | undefined,
  instances: { id: string; label: string }[] | undefined,
): string {
  if (!id) return DASH;

  return instances?.find((item) => item.id === id)?.label ?? id;
}

/** `?a=1&b=2` from the non-empty values, or `""`. */
export function queryString(values: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;

    const text = String(value).trim();

    if (text) params.set(key, text);
  }

  const text = params.toString();

  return text ? `?${text}` : "";
}
