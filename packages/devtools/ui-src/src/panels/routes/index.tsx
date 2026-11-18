import { useState } from "react";
import type { DevtoolsRouteStatsRow, DevtoolsRouteStatsView } from "@contracts";
import { useApi } from "@/api/hooks";
import { PercentileBar } from "@/components/charts";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  ClearFilters,
  FilterBar,
  HEAD,
  MethodPill,
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
import { DASH, formatMs, formatNumber, queryString, SelectField } from "@/components/ui/panel-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DevtoolsPanelProps } from "@/panels/types";

type RouteEntry = { method: string; path: string; name?: string; middleware?: string[] };
type SortKey = "total" | "p95" | "count" | "errors";

function PhaseBars({ route }: { route: DevtoolsRouteStatsRow }) {
  const phases = route.phases.slice(0, 8);
  const peak = Math.max(...phases.map((phase) => phase.sumMs), 1);

  if (!phases.length)
    return <p className="text-xs text-muted-foreground">No phase timings for this route.</p>;

  return (
    <ul className="m-0 list-none space-y-1 p-0" aria-label="Slowest phases">
      {phases.map((phase) => (
        <li key={phase.name} className="grid grid-cols-[10rem_1fr_6rem] items-center gap-2 text-xs">
          <span className="truncate font-mono" title={phase.name}>
            {phase.name}
          </span>
          <span className="h-3 rounded-sm bg-muted">
            <span
              className="block h-3 rounded-sm"
              style={{ width: `${(phase.sumMs / peak) * 100}%`, background: "var(--chart-3)" }}
            />
          </span>
          <span className="text-right tabular-nums">
            {formatMs(phase.sumMs / Math.max(phase.count, 1))} avg
          </span>
        </li>
      ))}
    </ul>
  );
}

function RouteStats({ instance }: Pick<DevtoolsPanelProps, "instance">) {
  const [sort, setSort] = useState<SortKey>("total");
  const [open, setOpen] = useState<string | null>(null);
  const path = `api/routes/stats${queryString({ sort, instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsRouteStatsView>(path, {
    refreshMs: 10_000,
  });
  const percent = data ? Math.round(data.sampleRate * 1000) / 10 : null;

  const routes = data?.routes ?? [];
  const requests = routes.reduce((sum, route) => sum + route.count, 0);
  const failed = routes.reduce((sum, route) => sum + route.errors, 0);
  const slowestP95 = Math.max(0, ...routes.map((route) => route.p95Ms));

  return (
    <section aria-label="Route statistics">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Route statistics</h3>
          <p className="text-sm text-muted-foreground">
            {percent !== null && percent < 100
              ? `Counts come from sampled requests (${percent} %).`
              : "How long each route takes, slowest total first."}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Sort by
          <SelectField value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="total">Total time</option>
            <option value="p95">p95</option>
            <option value="count">Count</option>
            <option value="errors">Errors</option>
          </SelectField>
        </label>
      </div>
      {error ? (
        <ErrorMessage error={error} title="Could not load the route statistics" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data && !data.routes.length ? (
        <EmptyState
          title="No route timings yet. Make some requests to your app."
          hint="Routes appear here after they serve a request."
        />
      ) : null}
      {data?.routes.length ? (
        <>
          <StatTiles
            label="Route summary"
            items={[
              { label: "Routes timed", value: formatNumber(routes.length) },
              { label: "Requests", value: formatNumber(requests) },
              {
                label: "Failed requests",
                value: formatNumber(failed),
                hint: "5xx or thrown errors",
                tone: failed ? "destructive" : "success",
              },
              { label: "Slowest p95", value: formatMs(slowestP95) },
            ]}
          />
          <TableCard label="Route statistics table">
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD}>Route</TableHead>
                <TableHead className={`${HEAD} ${NUM_CELL}`}>Count</TableHead>
                <TableHead className={`${HEAD} ${NUM_CELL}`}>p50</TableHead>
                <TableHead className={`${HEAD} ${NUM_CELL}`}>p95</TableHead>
                <TableHead className={HEAD}>Spread</TableHead>
                <TableHead className={`${HEAD} ${NUM_CELL}`}>Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.routes.map((route) => (
                <RouteRow
                  key={route.key}
                  route={route}
                  open={open === route.key}
                  onToggle={() => setOpen(open === route.key ? null : route.key)}
                />
              ))}
            </TableBody>
          </TableCard>
        </>
      ) : null}
    </section>
  );
}

function RouteRow({
  route,
  open,
  onToggle,
}: {
  route: DevtoolsRouteStatsRow;
  open: boolean;
  onToggle: () => void;
}) {
  const toggle = rowOpen(onToggle);

  return (
    <>
      <TableRow data-state={open ? "selected" : undefined} {...toggle}>
        <TableCell className="max-w-0 min-w-56 font-mono text-xs">
          <button
            type="button"
            className="block max-w-full truncate text-left focus-visible:outline-none"
            title={route.key}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {route.key}
          </button>
        </TableCell>
        <TableCell className={NUM_CELL}>{formatNumber(route.count)}</TableCell>
        <TableCell className={NUM_CELL}>{formatMs(route.p50Ms)}</TableCell>
        <TableCell className={NUM_CELL}>{formatMs(route.p95Ms)}</TableCell>
        <TableCell>
          <PercentileBar p50={route.p50Ms} p95={route.p95Ms} max={route.histogram.maxMs} />
        </TableCell>
        <TableCell className={NUM_CELL}>
          {route.errors ? (
            <Pill tone="destructive" mono>
              {route.errors}
            </Pill>
          ) : (
            DASH
          )}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/20">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Slowest phases</p>
            <PhaseBars route={route} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function RouteMap() {
  const { data, error, loading, reload } = useApi<RouteEntry[]>("api/routes");
  const [needle, setNeedle] = useState("");
  const [method, setMethod] = useState("");
  const text = needle.toLowerCase();
  const all = data ?? [];
  const methods = [...new Set(all.map((route) => route.method.toUpperCase()))].sort();
  const routes = all.filter(
    (route) =>
      (!method || route.method.toUpperCase() === method) &&
      `${route.method} ${route.path} ${route.name ?? ""} ${(route.middleware ?? []).join(" ")}`
        .toLowerCase()
        .includes(text),
  );
  const filtered = Boolean(needle) || Boolean(method);

  return (
    <section aria-label="Route map" className="mt-8">
      <div className="mb-3">
        <h3 className="text-base font-semibold">Route map</h3>
        <p className="text-sm text-muted-foreground">Every route the app registered.</p>
      </div>
      <FilterBar
        label="Route filters"
        trailing={
          <>
            <ResultCount shown={routes.length} total={all.length} noun="route" />
            {filtered ? (
              <ClearFilters
                onClick={() => {
                  setNeedle("");
                  setMethod("");
                }}
              />
            ) : null}
          </>
        }
      >
        <SearchField
          label="Filter routes"
          placeholder="Filter routes"
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
        />
        {methods.length > 1 ? (
          <Segmented
            label="Method"
            value={method}
            onChange={setMethod}
            options={[
              { value: "", label: "All" },
              ...methods.map((name) => ({ value: name, label: name })),
            ]}
          />
        ) : null}
      </FilterBar>
      {error ? (
        <ErrorMessage error={error} title="Could not load the route map" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data && !routes.length ? (
        <EmptyState
          title="No routes found."
          hint={
            filtered
              ? "Clear the filters to see every route."
              : "Register routes in your app and restart it."
          }
        />
      ) : null}
      {routes.length ? (
        <TableCard label="Route map table">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Method</TableHead>
              <TableHead className={HEAD}>Path</TableHead>
              <TableHead className={HEAD}>Name</TableHead>
              <TableHead className={HEAD}>Middleware</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route, index) => (
              <TableRow key={`${route.method} ${route.path} ${index}`}>
                <TableCell className="w-24">
                  <MethodPill method={route.method} />
                </TableCell>
                <TableCell className="max-w-0 min-w-48 font-mono text-xs">
                  <div className="truncate" title={route.path}>
                    {route.path}
                  </div>
                </TableCell>
                <TableCell>{route.name || DASH}</TableCell>
                <TableCell className="text-xs whitespace-normal">
                  {(route.middleware ?? []).join(", ") || DASH}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      ) : null}
    </section>
  );
}

/** The Routes tab: timing statistics per route, then the route map. */
export function RoutesPanel({ instance }: DevtoolsPanelProps) {
  return (
    <div>
      <PageHeader
        title="Routes"
        description="How each route performs, and the full map of routes your app registered."
      />
      <RouteStats instance={instance} />
      <RouteMap />
    </div>
  );
}
