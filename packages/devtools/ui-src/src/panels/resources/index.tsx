import type { DevtoolsResourcePoint, DevtoolsResourcesView } from "@contracts";
import { useApi } from "@/api/hooks";
import { LineChart, Sparkline } from "@/components/charts";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import { PageHeader, StatTiles } from "@/components/listing";
import {
  formatBytes,
  formatDuration,
  formatMs,
  formatNumber,
  formatPercent,
  queryString,
} from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";

type Entry = DevtoolsResourcesView["instances"][number];

function Metric({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: readonly number[];
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {trend ? <Sparkline values={trend} width={110} height={24} label={`${label} trend`} /> : null}
    </div>
  );
}

const series = (history: DevtoolsResourcePoint[], pick: (point: DevtoolsResourcePoint) => number) =>
  history.map((point) => ({ at: point.at, value: pick(point) }));

function InstanceResources({ entry }: { entry: Entry }) {
  const { snapshot, history } = entry;
  const all = [...history, snapshot].filter(
    (point, index, list) => index === list.findIndex((other) => other.at === point.at),
  );
  const gc = Object.entries(snapshot.gcByKind).filter(([, value]) => value.count > 0);
  const heapPercent = snapshot.heapLimitBytes
    ? (snapshot.heapUsedBytes / snapshot.heapLimitBytes) * 100
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {entry.instance.label}{" "}
          <span className="font-normal text-muted-foreground">
            · up {formatDuration(snapshot.uptimeSeconds)} · Node {entry.instance.nodeVersion}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric
            label="RSS"
            value={formatBytes(snapshot.rssBytes)}
            trend={all.map((point) => point.rssBytes)}
          />
          <Metric
            label="Heap used"
            value={`${formatBytes(snapshot.heapUsedBytes)}${heapPercent === null ? "" : ` (${heapPercent.toFixed(0)} % of limit)`}`}
            trend={all.map((point) => point.heapUsedBytes)}
          />
          <Metric
            label="Heap total / limit"
            value={`${formatBytes(snapshot.heapTotalBytes)} / ${formatBytes(snapshot.heapLimitBytes)}`}
          />
          <Metric
            label="CPU"
            value={formatPercent(snapshot.cpuPercent)}
            trend={all.map((point) => point.cpuPercent)}
          />
          <Metric label="Event loop delay p50" value={formatMs(snapshot.eventLoopDelayP50Ms)} />
          <Metric label="Event loop delay p99" value={formatMs(snapshot.eventLoopDelayP99Ms)} />
          <Metric label="Event loop delay max" value={formatMs(snapshot.eventLoopDelayMaxMs)} />
          <Metric
            label="Event loop utilization"
            value={formatPercent(snapshot.eventLoopUtilization * 100, 0)}
            trend={all.map((point) => point.eventLoopUtilization)}
          />
          <Metric label="GC runs (last interval)" value={formatNumber(snapshot.gcCount)} />
          <Metric label="GC pause (last interval)" value={formatMs(snapshot.gcPauseMs)} />
          <Metric label="External memory" value={formatBytes(snapshot.externalBytes)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <LineChart
            title="Memory"
            format={formatBytes}
            series={[
              {
                name: "RSS",
                color: "var(--chart-1)",
                points: series(all, (point) => point.rssBytes),
              },
              {
                name: "Heap used",
                color: "var(--chart-2)",
                points: series(all, (point) => point.heapUsedBytes),
              },
              {
                name: "Heap total",
                color: "var(--chart-3)",
                points: series(all, (point) => point.heapTotalBytes),
              },
            ]}
          />
          <LineChart
            title="Event loop delay"
            format={(value) => formatMs(value)}
            series={[
              {
                name: "p50",
                color: "var(--chart-2)",
                points: series(all, (point) => point.eventLoopDelayP50Ms),
              },
              {
                name: "p99",
                color: "var(--chart-1)",
                points: series(all, (point) => point.eventLoopDelayP99Ms),
              },
              {
                name: "max",
                color: "var(--chart-4)",
                points: series(all, (point) => point.eventLoopDelayMaxMs),
              },
            ]}
          />
          <LineChart
            title="CPU"
            format={(value) => formatPercent(value, 0)}
            series={[
              {
                name: "CPU",
                color: "var(--chart-1)",
                points: series(all, (point) => point.cpuPercent),
              },
            ]}
          />
          <LineChart
            title="Event loop utilization"
            format={(value) => formatPercent(value * 100, 0)}
            max={1}
            series={[
              {
                name: "ELU",
                color: "var(--chart-3)",
                points: series(all, (point) => point.eventLoopUtilization),
              },
            ]}
          />
        </div>
        {gc.length ? (
          <p className="text-xs text-muted-foreground">
            Garbage collection since start:{" "}
            {gc
              .map(
                ([kind, value]) => `${kind} ${value.count} runs, ${formatMs(value.pauseMs)} paused`,
              )
              .join(" · ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The Resources tab: memory, CPU, event loop and GC per instance, with history. */
export function ResourcesPanel({ instance }: DevtoolsPanelProps) {
  const path = `api/resources${queryString({ instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsResourcesView>(path, { refreshMs: 5000 });

  const entries = data?.instances ?? [];
  const peak = (pick: (entry: Entry) => number) => Math.max(0, ...entries.map(pick));

  return (
    <div>
      <PageHeader
        title="Resources"
        description="Memory, CPU, event loop and garbage collection of each running instance. Updated every 5 seconds."
      >
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCwIcon />
          Refresh
        </Button>
      </PageHeader>
      {error ? (
        <ErrorMessage error={error} title="Could not load the resource readings" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data && !data.instances.length ? (
        <EmptyState
          title="No instance has reported its resources yet. Readings appear a few seconds after the app starts."
          hint="If the app is running and this stays empty, check that the monitor is enabled."
        />
      ) : null}
      {entries.length ? (
        <StatTiles
          items={[
            { label: "Instances", value: formatNumber(entries.length) },
            {
              label: "Highest memory (RSS)",
              value: formatBytes(peak((entry) => entry.snapshot.rssBytes)),
            },
            {
              label: "Highest CPU",
              value: formatPercent(peak((entry) => entry.snapshot.cpuPercent)),
            },
            {
              label: "Worst event loop p99",
              value: formatMs(peak((entry) => entry.snapshot.eventLoopDelayP99Ms)),
            },
          ]}
        />
      ) : null}
      <div className="space-y-4">
        {data?.instances.map((entry) => (
          <InstanceResources key={entry.instance.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
