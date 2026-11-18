import { Skeleton } from "@/components/ui/skeleton";

export type LoadingRowsProps = {
  /** How many placeholder rows to draw (default 5). */
  rows?: number;
  className?: string;
};

/** Skeleton rows shown while the first answer of a list is on its way. */
export function LoadingRows({ rows = 5, className }: LoadingRowsProps) {
  return (
    <div className={className} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          className="mb-2 h-9 w-full"
          style={{ opacity: 1 - index * (0.6 / Math.max(rows, 1)) }}
        />
      ))}
    </div>
  );
}
