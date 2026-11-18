import type { ComponentProps, FormEvent, ReactNode } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/panel-kit";
import { cn } from "@/lib/utils";

/** The row of filters above a listing. Pass `onSubmit` when the filters apply on submit. */
export function FilterBar({
  label,
  onSubmit,
  children,
  trailing,
}: {
  label: string;
  onSubmit?: (event: FormEvent) => void;
  children: ReactNode;
  /** The result count and the clear action, shown at the end of the row. */
  trailing?: ReactNode;
}) {
  return (
    <form
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(event);
      }}
      className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2"
    >
      {children}
      {trailing ? (
        <div className="ml-auto flex flex-wrap items-center gap-2 pl-2">{trailing}</div>
      ) : null}
    </form>
  );
}

/** A search box with a magnifier. */
export function SearchField({
  label,
  className,
  ...props
}: { label: string } & Omit<ComponentProps<"input">, "aria-label">) {
  return (
    <div className={cn("relative min-w-48 flex-1", className)}>
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <TextField type="search" aria-label={label} className="w-full pl-8" {...props} />
    </div>
  );
}

export type SegmentOption = { value: string; label: string; count?: number };

/** A group of mutually exclusive choices (status class, level) shown as one joined control. */
export function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-md border bg-muted/50 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="text-[11px] tabular-nums opacity-70">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** "42 of 310 requests" when filtered, "310 requests" otherwise. */
export function ResultCount({
  shown,
  total,
  noun,
}: {
  shown: number;
  total?: number;
  noun: string;
}) {
  const plural = (count: number) =>
    count === 1 ? noun : /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;

  return (
    <span role="status" className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      {total !== undefined && total !== shown
        ? `${shown} of ${total} ${plural(total)}`
        : `${shown} ${plural(shown)}`}
    </span>
  );
}

export function ClearFilters({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" size="xs" variant="ghost" onClick={onClick}>
      <XIcon />
      Clear filters
    </Button>
  );
}
