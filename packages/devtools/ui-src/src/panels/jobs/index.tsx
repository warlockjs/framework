import type { DevtoolsJobsReport, DevtoolsJobsView } from "@contracts";
import { useApi } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  DASH,
  formatMs,
  formatNumber,
  NUM,
  PanelHeader,
  queryString,
  Time,
} from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";

function Schedules({ report }: { report: DevtoolsJobsReport }) {
  if (!report.available.scheduler) {
    return (
      <EmptyState title="The scheduler is not installed in this app. Install @warlock.js/scheduler to see its jobs here." />
    );
  }

  if (!report.schedules.length) return <EmptyState title="No scheduled jobs are registered." />;

  return (
    <Table aria-label="Schedules">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Schedule</TableHead>
          <TableHead>Last run</TableHead>
          <TableHead>Next run</TableHead>
          <TableHead className={NUM}>Duration</TableHead>
          <TableHead className={NUM}>Runs</TableHead>
          <TableHead className={NUM}>Failures</TableHead>
          <TableHead>Last error</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.schedules.map((job) => (
          <TableRow key={job.name}>
            <TableCell className="font-mono text-xs">
              {job.name} {job.isRunning ? <Badge variant="secondary">running</Badge> : null}
            </TableCell>
            <TableCell className="font-mono text-xs">{job.cron ?? job.interval ?? DASH}</TableCell>
            <TableCell>
              <Time at={job.lastRunAt} />
            </TableCell>
            <TableCell>
              <Time at={job.nextRunAt} />
            </TableCell>
            <TableCell className={NUM}>{formatMs(job.lastDurationMs)}</TableCell>
            <TableCell className={NUM}>{formatNumber(job.runs)}</TableCell>
            <TableCell className={NUM}>{job.failures || DASH}</TableCell>
            <TableCell className="max-w-xs text-xs whitespace-normal text-destructive">
              {job.lastError ?? DASH}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Queues({ report }: { report: DevtoolsJobsReport }) {
  if (!report.available.queue) {
    return (
      <EmptyState title="The queue is not installed in this app. Install @warlock.js/queue to see its job counts here." />
    );
  }

  if (!report.queues.length) return <EmptyState title="No queue reported job counts." />;

  const states = [...new Set(report.queues.flatMap((queue) => Object.keys(queue.counts)))];

  return (
    <Table aria-label="Queues">
      <TableHeader>
        <TableRow>
          <TableHead>Queue</TableHead>
          {states.map((state) => (
            <TableHead key={state} className={NUM}>
              {state}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.queues.map((queue) => (
          <TableRow key={queue.name}>
            <TableCell className="font-mono text-xs">{queue.name}</TableCell>
            {states.map((state) => (
              <TableCell key={state} className={NUM}>
                {formatNumber(queue.counts[state] ?? 0)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The Jobs tab: schedules and queue counts per instance. */
export function JobsPanel({ instance }: DevtoolsPanelProps) {
  const path = `api/jobs${queryString({ instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsJobsView>(path, { refreshMs: 10_000 });

  return (
    <div>
      <PanelHeader title="Jobs" />
      {error ? (
        <ErrorMessage error={error} title="Could not load the jobs" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data && !data.instances.length ? (
        <EmptyState title="No instance has reported its jobs yet." />
      ) : null}
      <div className="space-y-4">
        {data?.instances.map(({ instance: info, report }) => (
          <Card key={info.id}>
            <CardHeader>
              <CardTitle className="text-sm">{info.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <section aria-label={`Schedules on ${info.label}`}>
                <h3 className="mb-2 text-sm font-semibold">Schedules</h3>
                <Schedules report={report} />
              </section>
              <section aria-label={`Queues on ${info.label}`}>
                <h3 className="mb-2 text-sm font-semibold">Queues</h3>
                <Queues report={report} />
              </section>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
