import { RefreshCwIcon } from "lucide-react";
import type { DevtoolsHealthReport, DevtoolsHealthView } from "@contracts";
import { useApi } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import { PageHeader, Pill, StatTiles } from "@/components/listing";
import { formatNumber, queryString, Time } from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";

function statusPill(status: DevtoolsHealthReport["status"]) {
  if (status === "ok") return <Pill tone="success">ok</Pill>;
  if (status === "error") return <Pill tone="destructive">error</Pill>;

  return <Pill>unknown</Pill>;
}

function HistoryStrip({ history }: { history: DevtoolsHealthReport["history"] }) {
  if (!history.length) return <p className="text-xs text-muted-foreground">No history yet.</p>;

  return (
    <ul
      className="m-0 flex list-none flex-wrap gap-0.5 p-0"
      aria-label="Health history, oldest first"
    >
      {history.map((entry) => (
        <li
          key={entry.at}
          className="h-6 w-2 rounded-sm"
          style={{ background: entry.status === "ok" ? "var(--success)" : "var(--destructive)" }}
          title={`${new Date(entry.at).toLocaleTimeString()}: ${entry.status}${entry.failed.length ? ` (${entry.failed.join(", ")})` : ""}`}
        />
      ))}
    </ul>
  );
}

/** The Health tab: readiness status, each check and a history strip per instance. */
export function HealthPanel({ instance }: DevtoolsPanelProps) {
  const path = `api/health${queryString({ instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsHealthView>(path, { refreshMs: 15_000 });
  const entries = data?.instances ?? [];
  const healthy = entries.filter((entry) => entry.report.status === "ok").length;
  const allChecks = entries.flatMap((entry) => Object.values(entry.report.checks));
  const failing = allChecks.filter((passing) => !passing).length;

  return (
    <div>
      <PageHeader
        title="Health"
        description="Readiness checks of each instance, updated every 15 seconds."
      >
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCwIcon />
          Refresh
        </Button>
      </PageHeader>
      {error ? (
        <ErrorMessage error={error} title="Could not load the health checks" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data && !data.instances.length ? (
        <EmptyState
          title="No instance has reported a health check yet. The first check runs shortly after the app starts."
          hint="Register readiness checks in your app to see them here."
        />
      ) : null}
      {entries.length ? (
        <StatTiles
          items={[
            { label: "Instances", value: formatNumber(entries.length) },
            {
              label: "Ready",
              value: `${healthy} / ${entries.length}`,
              tone: healthy === entries.length ? "success" : "destructive",
            },
            { label: "Checks", value: formatNumber(allChecks.length) },
            {
              label: "Failing checks",
              value: formatNumber(failing),
              tone: failing ? "destructive" : "success",
            },
          ]}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {entries.map(({ instance: info, report }) => {
          const checks = Object.entries(report.checks);

          return (
            <Card key={info.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {info.label} {statusPill(report.status)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Checked <Time at={report.checkedAt} />
                </p>
                {checks.length ? (
                  <ul className="divide-y rounded-lg border text-sm">
                    {checks.map(([name, passing]) => (
                      <li key={name} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 truncate font-mono text-xs" title={name}>
                          {name}
                        </span>
                        <Pill tone={passing ? "success" : "destructive"}>
                          {passing ? "passing" : "failing"}
                        </Pill>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No readiness checks are registered.
                  </p>
                )}
                <HistoryStrip history={report.history} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
