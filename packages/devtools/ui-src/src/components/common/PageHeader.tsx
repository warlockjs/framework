import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageHeaderProps = {
  title: string;
  /** One line under the title saying what the page is for. */
  description?: ReactNode;
  /** Controls on the right (filters, refresh, primary action). */
  children?: ReactNode;
  className?: string;
};

/** The title row of a page: heading, a short description and the page's controls. */
export function PageHeader({ title, description, children, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
