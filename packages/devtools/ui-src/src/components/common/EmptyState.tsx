import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  /** What is missing, in one sentence ("No requests captured yet."). */
  title: string;
  /** What to do next, when there is something to do. */
  hint?: ReactNode;
  className?: string;
};

/** A centred note for a list or tab that has nothing to show. */
export function EmptyState({ title, hint, className }: EmptyStateProps) {
  return (
    <div className={cn("rounded-lg border border-dashed p-8 text-center", className)}>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
