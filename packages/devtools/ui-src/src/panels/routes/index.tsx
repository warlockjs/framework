import { useState } from "react";
import type { DevtoolsRouteStatsRow, DevtoolsRouteStatsView } from "@contracts";
import { useApi } from "@/api/hooks";
import { PercentileBar } from "@/components/charts";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  DASH,
  formatMs,
  formatNumber,
  NUM,
  PanelHeader,
  queryString,
  SectionTitle,
  SelectField,
  TextField,
} from "@/components/ui/panel-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  return (
    <section aria-label="Route statistics">
      <PanelHeader
        title="Route statistics"
        note={
          percent !== null && percent < 100
            ? `Counts come from sampled requests (${percent} %).`
            : undefined
        }
      >
        <label className="flex items-center gap-2 text-sm">
          Sort by
          <SelectField value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="total">Total time</option>
            <option value="p95">p95</option>
            <option value="count">Count</option>
            <option value="errors">Errors</option>
          </SelectField>
        </label>
      </PanelHeader>
      {error ? (
        <ErrorMessage error={error} title="Could not load the route statistics" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data && !data.routes.length ? (
        <EmptyState title="No route timings yet. Make some requests to your app." />
      ) : null}
      {data?.routes.length ? (
        <Table aria-label="Route statistics table">
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead className={NUM}>Count</TableHead>
              <TableHead className={NUM}>p50</TableHead>
              <TableHead className={NUM}>p95</TableHead>
              <TableHead>Spread</TableHead>
              <TableHead className={NUM}>Errors</TableHead>
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
        </Table>
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
  return (
    <>
      <TableRow data-state={open ? "selected" : undefined}>
        <TableCell className="font-mono text-xs">
          <button type="button" className="text-left" aria-expanded={open} onClick={onToggle}>
            {route.key}
          </button>
        </TableCell>
        <TableCell className={NUM}>{formatNumber(route.count)}</TableCell>
        <TableCell className={NUM}>{formatMs(route.p50Ms)}</TableCell>
        <TableCell className={NUM}>{formatMs(route.p95Ms)}</TableCell>
        <TableCell>
          <PercentileBar p50={route.p50Ms} p95={route.p95Ms} max={route.histogram.maxMs} />
        </TableCell>
        <TableCell className={NUM}>{route.errors || DASH}</TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={6}>
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
  const text = needle.toLowerCase();
  const routes = (data ?? []).filter((route) =>
    `${route.method} ${route.path} ${route.name ?? ""} ${(route.middleware ?? []).join(" ")}`
      .toLowerCase()
      .includes(text),
  );

  return (
    <section aria-label="Route map">
      <SectionTitle>Route map</SectionTitle>
      <TextField
        placeholder="Filter routes"
        aria-label="Filter routes"
        className="mb-2"
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
      />
      {error ? (
        <ErrorMessage error={error} title="Could not load the route map" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data && !routes.length ? <EmptyState title="No routes found." /> : null}
      {routes.length ? (
        <Table aria-label="Route map table">
          <TableHeader>
            <TableRow>
              <TableHead>Method</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Middleware</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route, index) => (
              <TableRow key={`${route.method} ${route.path} ${index}`}>
                <TableCell className="font-mono text-xs">{route.method}</TableCell>
                <TableCell className="font-mono text-xs">{route.path}</TableCell>
                <TableCell>{route.name || DASH}</TableCell>
                <TableCell className="text-xs whitespace-normal">
                  {(route.middleware ?? []).join(", ") || DASH}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}

/** The Routes tab: timing statistics per route, then the route map. */
export function RoutesPanel({ instance }: DevtoolsPanelProps) {
  return (
    <div>
      <RouteStats instance={instance} />
      <RouteMap />
    </div>
  );
}
