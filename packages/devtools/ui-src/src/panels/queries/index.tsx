import { useMemo, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { DevtoolsQueryShapeRow, DevtoolsQueryStatsView } from "@contracts";
import { apiFetch } from "@/api/client";
import { useApi } from "@/api/hooks";
import { HistogramBars } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  BackButton,
  ClearFilters,
  CodeBlock,
  DetailSection,
  DurationBar,
  FilterBar,
  HEAD,
  KeyValueGrid,
  NUM_CELL,
  PageHeader,
  Pill,
  ResultCount,
  rowOpen,
  SearchField,
  Segmented,
  StatTiles,
  TableCard,
} from "@/components/listing";
import {
  DASH,
  formatMs,
  formatNumber,
  queryString,
  SelectField,
  Time,
} from "@/components/ui/panel-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DevtoolsPanelProps } from "@/panels/types";
import { BackgroundQueries } from "./BackgroundQueries";
import { ExplainBox, type ExplainOutcome } from "./ExplainBox";

/** A shape counts as slow when its p95 is at or above this many milliseconds. */
const SLOW_P95_MS = 100;

const SHOW = [
  { value: "all", label: "All" },
  { value: "slow", label: "Slow" },
  { value: "nplus", label: "N+1" },
  { value: "errors", label: "Errors" },
];

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
  onClose,
}: {
  shape: DevtoolsQueryShapeRow;
  isAdmin: boolean;
  production: boolean;
  onClose: () => void;
}) {
  const slowest = shape.slowest;
  const run = () =>
    apiFetch<ExplainOutcome>(`api/queries/${encodeURIComponent(shape.id)}/explain`, {
      method: "POST",
    });

  return (
    <section aria-label="Query detail" className="space-y-3">
      <div>
        <BackButton onClick={onClose}>Close query</BackButton>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Pill>{shape.driver}</Pill>
          {shape.connection}
        </h3>
      </div>
      <KeyValueGrid
        items={[
          { label: "Runs", value: formatNumber(shape.count) },
          { label: "p50", value: formatMs(shape.p50Ms) },
          { label: "p95", value: formatMs(shape.p95Ms) },
          { label: "Max", value: formatMs(shape.histogram.maxMs) },
          { label: "Errors", value: shape.errors || DASH },
          { label: "Last seen", value: <Time at={shape.lastSeen} /> },
        ]}
      />
      <DetailSection title="Query shape">
        <CodeBlock>{shape.shape}</CodeBlock>
      </DetailSection>
      <DetailSection title="Latency">
        <HistogramBars histogram={shape.histogram} />
      </DetailSection>
      <DetailSection title="Slowest example">
        {slowest ? (
          <p className="text-sm">
            <span className="tabular-nums">{formatMs(slowest.durationMs)}</span> ·{" "}
            <Time at={slowest.at} />
            {slowest.route ? <> · {slowest.route}</> : null}
            {slowest.requestId ? (
              <>
                {" "}
                ·{" "}
                <a
                  className="underline"
                  href={`#requests/${encodeURIComponent(slowest.requestId)}`}
                >
                  open request
                </a>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No slow example kept yet.</p>
        )}
      </DetailSection>
      {shape.nPlusOne.requests ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm">
          <Pill tone="warning">N+1</Pill> in {shape.nPlusOne.requests} sampled requests, up to{" "}
          {shape.nPlusOne.maxPerRequest} runs in one request.
        </p>
      ) : null}
      {isAdmin ? (
        <DetailSection title="EXPLAIN">
          {shape.explainable ? (
            <>
              <ExplainBox run={run} />
              {production ? (
                <p className="text-xs text-muted-foreground">
                  EXPLAIN uses the slowest example, held by the instance that ran it. It only plans
                  the query unless the project allows executing plans.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              EXPLAIN is not available for this query type (Postgres SELECT/WITH and MongoDB find,
              aggregate and count only).
            </p>
          )}
        </DetailSection>
      ) : null}
    </section>
  );
}

/** The Queries tab: statistics per query shape, with a detail view and EXPLAIN for admins. */
export function QueriesPanel({ route, navigate, instance, session }: DevtoolsPanelProps) {
  const [sort, setSort] = useState<SortKey>("total");
  const [search, setSearch] = useState("");
  const [show, setShow] = useState("all");
  const production = session.mode === "production";
  const isAdmin = session.role === "admin";
  const path = `api/queries/stats${queryString({ sort, instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsQueryStatsView>(path, {
    refreshMs: 10_000,
  });
  const selected = data?.shapes.find((shape) => shape.id === route);
  const percent = data ? Math.round(data.sampleRate * 1000) / 10 : null;
  const filtered = Boolean(search.trim()) || show !== "all";

  const shapes = useMemo(() => {
    const term = search.trim().toLowerCase();

    return (data?.shapes ?? []).filter((shape) => {
      if (term && !shape.shape.toLowerCase().includes(term)) return false;
      if (show === "slow") return shape.p95Ms >= SLOW_P95_MS;
      if (show === "nplus") return shape.nPlusOne.requests > 0;
      if (show === "errors") return shape.errors > 0;

      return true;
    });
  }, [data, search, show]);

  const all = data?.shapes ?? [];
  const slowShapes = all.filter((shape) => shape.p95Ms >= SLOW_P95_MS).length;
  const nPlusOneShapes = all.filter((shape) => shape.nPlusOne.requests > 0).length;
  const errorRuns = all.reduce((sum, shape) => sum + shape.errors, 0);
  const slowestP95 = Math.max(0, ...shapes.map((shape) => shape.p95Ms));
  const clearFilters = () => {
    setSearch("");
    setShow("all");
  };

  return (
    <div>
      <PageHeader
        title="Queries"
        description={
          data
            ? `${
                percent !== null && percent < 100
                  ? `Counts come from sampled requests (${percent} %).`
                  : "Counts cover every request."
              }`
            : "Database queries grouped by shape, with latency, errors and N+1 findings."
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
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCwIcon />
          Refresh
        </Button>
      </PageHeader>
      {error ? (
        <ErrorMessage error={error} title="Could not load the query statistics" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.shapes.length ? (
        <EmptyState
          title="No queries recorded yet. Make requests that use the database; they appear here."
          hint="Shapes appear after the first sampled request runs a query."
        />
      ) : null}
      {data?.shapes.length ? (
        <>
          <StatTiles
            items={[
              { label: "Query shapes", value: formatNumber(all.length) },
              {
                label: "Total runs",
                value: formatNumber(all.reduce((sum, shape) => sum + shape.count, 0)),
              },
              {
                label: "Slow shapes",
                value: formatNumber(slowShapes),
                hint: `p95 of ${SLOW_P95_MS} ms or more`,
                tone: slowShapes ? "warning" : "success",
              },
              {
                label: "N+1 shapes",
                value: formatNumber(nPlusOneShapes),
                tone: nPlusOneShapes ? "warning" : "success",
              },
              {
                label: "Failed runs",
                value: formatNumber(errorRuns),
                tone: errorRuns ? "destructive" : "success",
              },
            ]}
          />
          <FilterBar
            label="Query filters"
            trailing={
              <>
                <ResultCount shown={shapes.length} total={all.length} noun="shape" />
                {filtered ? <ClearFilters onClick={clearFilters} /> : null}
              </>
            }
          >
            <SearchField
              label="Search queries"
              placeholder="Search query text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Segmented label="Show" options={SHOW} value={show} onChange={setShow} />
          </FilterBar>
          <div
            className={route ? "grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : undefined}
          >
            <div className="min-w-0">
              {shapes.length ? (
                <TableCard label="Query statistics">
                  <TableHeader>
                    <TableRow>
                      <TableHead className={HEAD}>Shape</TableHead>
                      <TableHead className={`${HEAD} ${NUM_CELL}`}>Count</TableHead>
                      <TableHead className={`${HEAD} ${NUM_CELL}`}>p50</TableHead>
                      <TableHead className={`${HEAD} ${NUM_CELL}`}>p95</TableHead>
                      <TableHead className={`${HEAD} ${NUM_CELL}`}>Mean</TableHead>
                      <TableHead className={`${HEAD} ${NUM_CELL}`}>Max</TableHead>
                      <TableHead className={`${HEAD} ${NUM_CELL}`}>Errors</TableHead>
                      <TableHead className={`${HEAD} ${NUM_CELL}`}>N+1</TableHead>
                      {production ? (
                        <TableHead className={`${HEAD} ${NUM_CELL}`}>Instances</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shapes.map((shape) => {
                      const open = rowOpen(() => navigate(shape.id));

                      return (
                        <TableRow
                          key={shape.id}
                          data-state={shape.id === route ? "selected" : undefined}
                          {...open}
                        >
                          <TableCell className="max-w-0 min-w-64 whitespace-normal">
                            <div className="flex items-start gap-2">
                              <Pill className="mt-0.5">{shape.driver}</Pill>
                              <button
                                type="button"
                                className="line-clamp-2 min-w-0 text-left font-mono text-xs break-all focus-visible:outline-none"
                                title={shape.shape}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(shape.id);
                                }}
                              >
                                {shape.shape.length > 200
                                  ? `${shape.shape.slice(0, 200)}…`
                                  : shape.shape}
                              </button>
                            </div>
                          </TableCell>
                          <TableCell className={NUM_CELL}>{formatNumber(shape.count)}</TableCell>
                          <TableCell className={NUM_CELL}>{formatMs(shape.p50Ms)}</TableCell>
                          <TableCell className={NUM_CELL}>
                            <DurationBar
                              ms={shape.p95Ms}
                              max={slowestP95}
                              text={formatMs(shape.p95Ms)}
                              tone={shape.p95Ms >= SLOW_P95_MS ? "bg-warning" : "bg-brand"}
                            />
                          </TableCell>
                          <TableCell className={NUM_CELL}>{formatMs(shape.meanMs)}</TableCell>
                          <TableCell className={NUM_CELL}>
                            {formatMs(shape.histogram.maxMs)}
                          </TableCell>
                          <TableCell className={NUM_CELL}>{shape.errors || DASH}</TableCell>
                          <TableCell className={NUM_CELL}>
                            {shape.nPlusOne.requests ? (
                              <Pill tone="warning" mono>
                                {shape.nPlusOne.requests}
                              </Pill>
                            ) : (
                              DASH
                            )}
                          </TableCell>
                          {production ? (
                            <TableCell className={NUM_CELL}>{shape.instances.length}</TableCell>
                          ) : null}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </TableCard>
              ) : (
                <EmptyState
                  title="No query matches these filters."
                  hint="Loosen the search or choose All."
                />
              )}
            </div>
            {route ? (
              <div className="min-w-0">
                {selected ? (
                  <ShapeDetail
                    shape={selected}
                    isAdmin={isAdmin}
                    production={production}
                    onClose={() => navigate("")}
                  />
                ) : (
                  <EmptyState
                    title="This query shape is no longer in the statistics. Pick another one."
                    hint="Statistics reset when the app restarts."
                  />
                )}
              </div>
            ) : null}
          </div>
        </>
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
