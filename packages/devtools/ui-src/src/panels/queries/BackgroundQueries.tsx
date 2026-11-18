import { useApi } from "@/api/hooks";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import { CodeBlock, DetailSection, Pill } from "@/components/listing";
import { formatMs } from "@/components/ui/panel-kit";

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
  const { data, error, loading, reload } = useApi<{ queries: BackgroundQuery[] }>(
    "api/background",
    {
      refreshMs: 10_000,
    },
  );

  return (
    <section aria-label="Background queries" className="mt-4">
      <DetailSection title="Background queries (outside any request)">
        {error ? (
          <ErrorMessage
            error={error}
            title="Could not load the background queries"
            onRetry={reload}
          />
        ) : null}
        {!data && loading ? <LoadingRows rows={2} /> : null}
        {data && !data.queries.length ? (
          <EmptyState
            title="No background queries yet."
            hint="Boot work, scheduler ticks and queue jobs that query the database show up here."
          />
        ) : null}
        <div className="space-y-2">
          {data?.queries.map((query) => (
            <div key={query.id} className="space-y-1.5 rounded-lg border p-2.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Pill>{query.driver}</Pill>
                <span className="tabular-nums">{formatMs(query.durationMs)}</span>
              </div>
              <CodeBlock>
                {query.sql ||
                  query.shape ||
                  `${query.collection ?? "collection"}.${query.command ?? "command"}`}
              </CodeBlock>
            </div>
          ))}
        </div>
      </DetailSection>
    </section>
  );
}
