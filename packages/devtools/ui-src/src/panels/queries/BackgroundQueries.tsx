import { useApi } from "@/api/hooks";
import { Code, EmptyState, ErrorMessage, formatMs, LoadingRows, SectionTitle } from "@/components/ui/panel-kit";

type BackgroundQuery = {
  id: string;
  driver: string;
  sql?: string;
  shape?: string;
  collection?: string;
  command?: string;
  durationMs: number;
};

/** Development only: queries that ran outside any request (boot, scheduler ticks, queue jobs). */
export function BackgroundQueries() {
  const { data, error, loading, reload } = useApi<{ queries: BackgroundQuery[] }>("api/background", {
    refreshMs: 10_000,
  });

  return (
    <section aria-label="Background queries">
      <SectionTitle>Background queries (outside any request)</SectionTitle>
      {error ? <ErrorMessage error={error} title="Could not load the background queries" onRetry={reload} /> : null}
      {!data && loading ? <LoadingRows rows={2} /> : null}
      {data && !data.queries.length ? <EmptyState>No background queries yet.</EmptyState> : null}
      <div className="space-y-2">
        {data?.queries.map((query) => (
          <div key={query.id} className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">
              {query.driver} · <span className="tabular-nums">{formatMs(query.durationMs)}</span>
            </div>
            <Code className="mt-1">{query.sql || query.shape || `${query.collection ?? "collection"}.${query.command ?? "command"}`}</Code>
          </div>
        ))}
      </div>
    </section>
  );
}
