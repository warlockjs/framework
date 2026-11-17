import { EmptyState, formatMs } from "@/components/ui/panel-kit";
import { queryText } from "./query-text";
import type { RequestDetail } from "./types";

type Entry = { label: string; at: number; duration: number; kind: "phase" | "query" | "cache" };

const COLORS = { phase: "var(--chart-3)", query: "var(--chart-1)", cache: "var(--chart-2)" } as const;

/** The timed work of one request as bars on the request's own time scale. */
export function Waterfall({ request }: { request: RequestDetail }) {
  const entries: Entry[] = [
    ...request.phases.map((item) => ({
      label: item.name,
      at: item.startedAt,
      duration: item.durationMs,
      kind: "phase" as const,
    })),
    ...request.queries.map((item) => ({
      label: queryText(item).replace(/\s+/g, " ").slice(0, 90),
      at: item.startedAt,
      duration: item.durationMs,
      kind: "query" as const,
    })),
    ...(Array.isArray(request.cache)
      ? request.cache.map((item) => ({
          label: `${item.type} ${item.key || item.keys?.join(", ") || ""}`.trim(),
          at: item.at,
          duration: item.durationMs || 0,
          kind: "cache" as const,
        }))
      : []),
  ];

  if (!entries.length) return <EmptyState>No timed work recorded for this request.</EmptyState>;

  const total = Math.max(request.durationMs || 0, 1);

  return (
    <div className="space-y-1" aria-label="Waterfall">
      {entries.map((entry, index) => {
        const start = Math.max(0, Math.min(100, ((entry.at - request.startedAt) / total) * 100));
        const width = Math.max(0.5, Math.min(100 - start, (entry.duration / total) * 100));

        return (
          <div key={index} className="grid grid-cols-[minmax(0,14rem)_1fr_4.5rem] items-center gap-2 text-xs">
            <span className="truncate font-mono" title={entry.label}>
              {entry.label}
            </span>
            <span className="relative h-3 rounded-sm bg-muted">
              <span
                className="absolute inset-y-0 rounded-sm"
                style={{ left: `${start}%`, width: `${width}%`, background: COLORS[entry.kind] }}
              />
            </span>
            <span className="text-right tabular-nums">{formatMs(entry.duration)}</span>
          </div>
        );
      })}
    </div>
  );
}
