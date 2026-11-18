import type { ComponentType, ReactNode } from "react";
import { InboxIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  /** What is missing, in one sentence ("No requests captured yet."). */
  title: string;
  /** What to do next, when there is something to do. */
  hint?: ReactNode;
  /** A lucide icon shown above the title (default: an inbox). */
  icon?: ComponentType<{ className?: string }>;
  className?: string;
};

/** A centred note for a list or tab that has nothing to show. */
export function EmptyState({ title, hint, icon: Icon = InboxIcon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="mb-3 grid size-10 place-items-center rounded-full bg-brand/10 text-brand">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {hint ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
