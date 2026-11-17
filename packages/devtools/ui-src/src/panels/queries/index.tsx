import { useState } from "react";
import type { DevtoolsQueryShapeRow, DevtoolsQueryStatsView } from "@contracts";
import { apiFetch } from "@/api/client";
import { useApi } from "@/api/hooks";
import { HistogramBars } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import {
  Code,
  EmptyState,
  ErrorMessage,
  formatMs,
  formatNumber,
  LoadingRows,
  NUM,
  PanelHeader,
  SectionTitle,
  SelectField,
  queryString,
  Time,
  DASH,
} from "@/components/ui/panel-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DevtoolsPanelProps } from "@/panels/types";
import { BackgroundQueries } from "./BackgroundQueries";
import { ExplainBox, type ExplainOutcome } from "./ExplainBox";

type SortKey = "total" | "p95" | "count" | "n+1";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "total", label: "Total time" },
  { value: "p95", label: "p95" },
  { value: "count", label: "Count" },
  { value: "n+1", label: "N+1" },
];

function ShapeDetail({
  shape,
  isAdmin,
  production,
}: {
  shape: DevtoolsQueryShapeRow;
  isAdmin: boolean;
  production: boolean;
}) {
  const slowest = shape.slowest;
  const run = () =>
    apiFetch<ExplainOutcome>(`api/queries/${encodeURIComponent(shape.id)}/explain`, { method: "POST" });

  return (
    <section aria-label="Query detail" className="rounded-lg border p-3">
      <h3 className="text-sm font-semibold">
        {shape.driver} · {shape.connection}
      </h3>
      <Code className="mt-2">{shape.shape}</Code>
      <SectionTitle>Latency</SectionTitle>
      <HistogramBars histogram={shape.histogram} />
      <SectionTitle>Slowest example</SectionTitle>
      {slowest ? (
        <p className="text-sm">
          <span className="tabular-nums">{formatMs(slowest.durationMs)}</span> · <Time at={slowest.at} />
          {slowest.route ? <> · {slowest.route}</> : null}
          {slowest.requestId ? (
            <>
              {" "}
              ·{" "}
              <a className="underline" href={`#requests/${encodeURIComponent(slowest.requestId)}`}>
                open request
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No slow example kept yet.</p>
      )}
      {shape.nPlusOne.requests ? (
        <p className="mt-2 text-sm">
          <Badge variant="destructive">N+1</Badge> in {shape.nPlusOne.requests} sampled requests, up to{" "}
          {shape.nPlusOne.maxPerRequest} runs in one request.
        </p>
      ) : null}
      {isAdmin ? (
        shape.explainable ? (
          <>
            <SectionTitle>EXPLAIN</SectionTitle>
            <ExplainBox run={run} />
            {production ? (
              <p className="mt-1 text-xs text-muted-foreground">
                EXPLAIN uses the slowest example, held by the instance that ran it. It only plans the query unless the
                project allows executing plans.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            EXPLAIN is not available for this query type (Postgres SELECT/WITH and MongoDB find, aggregate and count only).
          </p>
        )
      ) : null}
    </section>
  );
}

/** The Queries tab: statistics per query shape, with a detail view and EXPLAIN for admins. */
export function QueriesPanel({ route, navigate, instance, session }: DevtoolsPanelProps) {
  const [sort, setSort] = useState<SortKey>("total");
  const production = session.mode === "production";
  const isAdmin = session.role === "admin";
  const path = `api/queries/stats${queryString({ sort, instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsQueryStatsView>(path, { refreshMs: 10_000 });
  const selected = data?.shapes.find((shape) => shape.id === route);
  const percent = data ? Math.round(data.sampleRate * 1000) / 10 : null;

  return (
    <div>
      <PanelHeader
        title="Queries"
        note={
          data
            ? percent !== null && percent < 100
              ? `Counts come from sampled requests (${percent} %).`
              : "Counts cover every request."
            : undefined
        }
      >
        <label className="flex items-center gap-2 text-sm">
          Sort by
          <SelectField value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </SelectField>
        </label>
      </PanelHeader>
      {error ? <ErrorMessage error={error} title="Could not load the query statistics" onRetry={reload} /> : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.shapes.length ? (
        <EmptyState>No queries recorded yet. Make requests that use the database; they appear here.</EmptyState>
      ) : null}
      {data?.shapes.length ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Table aria-label="Query statistics">
            <TableHeader>
              <TableRow>
                <TableHead>Shape</TableHead>
                <TableHead className={NUM}>Count</TableHead>
                <TableHead className={NUM}>p50</TableHead>
                <TableHead className={NUM}>p95</TableHead>
                <TableHead className={NUM}>Mean</TableHead>
                <TableHead className={NUM}>Max</TableHead>
                <TableHead className={NUM}>Errors</TableHead>
                <TableHead className={NUM}>N+1</TableHead>
                {production ? <TableHead className={NUM}>Instances</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.shapes.map((shape) => (
                <TableRow
                  key={shape.id}
                  data-state={shape.id === route ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => navigate(shape.id)}
                >
                  <TableCell className="max-w-md font-mono text-xs break-words whitespace-pre-wrap">
                    <button
                      type="button"
                      className="text-left"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(shape.id);
                      }}
                    >
                      {shape.shape.length > 200 ? `${shape.shape.slice(0, 200)}…` : shape.shape}
                    </button>
                  </TableCell>
                  <TableCell className={NUM}>{formatNumber(shape.count)}</TableCell>
                  <TableCell className={NUM}>{formatMs(shape.p50Ms)}</TableCell>
                  <TableCell className={NUM}>{formatMs(shape.p95Ms)}</TableCell>
                  <TableCell className={NUM}>{formatMs(shape.meanMs)}</TableCell>
                  <TableCell className={NUM}>{formatMs(shape.histogram.maxMs)}</TableCell>
                  <TableCell className={NUM}>{shape.errors || DASH}</TableCell>
                  <TableCell className={NUM}>
                    {shape.nPlusOne.requests ? <Badge variant="destructive">{shape.nPlusOne.requests}</Badge> : DASH}
                  </TableCell>
                  {production ? <TableCell className={NUM}>{shape.instances.length}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            {selected ? (
              <ShapeDetail shape={selected} isAdmin={isAdmin} production={production} />
            ) : route ? (
              <EmptyState>This query shape is no longer in the statistics. Pick another one.</EmptyState>
            ) : (
              <EmptyState>Select a query to see its latency and slowest example.</EmptyState>
            )}
          </div>
        </div>
      ) : null}
      {data && data.evicted ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {data.evicted} less recently used shapes were dropped to keep memory bounded.
        </p>
      ) : null}
      {session.mode === "development" ? <BackgroundQueries /> : null}
    </div>
  );
}
