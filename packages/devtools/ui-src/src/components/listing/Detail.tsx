import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { CopyButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A titled block of a detail view. */
export function DetailSection({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions}
      </div>
      <div className="space-y-2 p-3.5">{children}</div>
    </section>
  );
}

/** Label and value pairs in a responsive grid. */
export function KeyValueGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 break-words tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Monospace text with a copy button; `value` is what the button copies (defaults to the text). */
export function CodeBlock({
  children,
  value,
  className,
}: {
  children: string;
  value?: string;
  className?: string;
}) {
  return (
    <div className="relative">
      <pre
        className={cn(
          "max-h-80 overflow-auto rounded-lg border bg-muted/50 p-3 pr-20 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap",
          className,
        )}
      >
        {children}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={value ?? children} size="xs" variant="ghost" />
      </div>
    </div>
  );
}

/** Goes back to the listing. */
export function BackButton({
  onClick,
  children = "Back to the list",
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <Button type="button" size="sm" variant="ghost" className="-ml-2 mb-2" onClick={onClick}>
      <ArrowLeftIcon />
      {children}
    </Button>
  );
}
