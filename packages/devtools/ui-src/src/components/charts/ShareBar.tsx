import type { ReactNode } from "react";

/** A figure with a thin bar under it that shows its share (0 to 1) of the whole. */
export function ShareBar({ share, children }: { share: number; children: ReactNode }) {
  const width = share > 0 ? Math.max(3, Math.min(100, share * 100)) : 0;

  return (
    <div className="ml-auto flex w-24 flex-col items-end gap-1">
      <span className="tabular-nums">{children}</span>
      <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-brand" style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}
