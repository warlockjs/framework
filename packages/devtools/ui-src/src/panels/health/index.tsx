import type { DevtoolsHealthReport, DevtoolsHealthView } from "@contracts";
import { useApi } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import { PanelHeader, queryString, Time } from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";

function statusBadge(status: DevtoolsHealthReport["status"]) {
  if (status === "ok") return <Badge className="bg-emerald-600 text-white">ok</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;

  return <Badge variant="outline">unknown</Badge>;
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
          className="h-5 w-2 rounded-sm"
          style={{ background: entry.status === "ok" ? "var(--chart-2)" : "var(--destructive)" }}
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

  return (
    <div>
      <PanelHeader title="Health" note="Readiness checks, updated every 15 seconds." />
      {error ? (
        <ErrorMessage error={error} title="Could not load the health checks" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data && !data.instances.length ? (
        <EmptyState title="No instance has reported a health check yet. The first check runs shortly after the app starts." />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.instances.map(({ instance: info, report }) => {
          const checks = Object.entries(report.checks);

          return (
            <Card key={info.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  {info.label} {statusBadge(report.status)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Checked <Time at={report.checkedAt} />
                </p>
                {checks.length ? (
                  <ul className="space-y-1 text-sm">
                    {checks.map(([name, passing]) => (
                      <li key={name} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{name}</span>
                        <span
                          className={
                            passing ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                          }
                        >
                          {passing ? "passing" : "failing"}
                        </span>
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
