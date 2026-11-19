import { RefreshCwIcon } from "lucide-react";
import type { DevtoolsJobsReport, DevtoolsJobsView, DevtoolsScheduleRun } from "@contracts";
import { useApi } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import { HEAD, NUM_CELL, PageHeader, Pill, StatTiles, TableCard } from "@/components/listing";
import { DASH, formatMs, formatNumber, queryString, Time } from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";

const RUN_TONE: Record<DevtoolsScheduleRun["outcome"], string> = {
  success: "bg-emerald-500",
  failed: "bg-destructive",
  skipped: "bg-muted-foreground/40",
};

/** The latest runs as small marks, newest first; each carries its detail as a tooltip. */
function RecentRuns({ runs }: { runs?: DevtoolsScheduleRun[] }) {
  if (!runs?.length) return <span className="text-muted-foreground">{DASH}</span>;

  return (
    <span className="inline-flex items-center gap-1" aria-label="Recent runs">
      {runs.map((run) => (
        <span
          key={run.startedAt + run.outcome}
          role="img"
          aria-label={`${run.outcome} run`}
          title={[
            `${run.outcome}, ${formatMs(run.durationMs)}`,
            new Date(run.startedAt).toLocaleString(),
            run.error ?? run.skipReason,
          ]
            .filter(Boolean)
            .join(" - ")}
          className={`inline-block h-3 w-1.5 rounded-sm ${RUN_TONE[run.outcome]}`}
        />
      ))}
    </span>
  );
}

function Schedules({ report }: { report: DevtoolsJobsReport }) {
  if (!report.available.scheduler) {
    return (
      <EmptyState
        title="The scheduler is not installed in this app. Install @warlock.js/scheduler to see its jobs here."
        hint="Add the package, register a job and restart the app."
      />
    );
  }

  if (!report.schedules.length)
    return (
      <EmptyState
        title="No scheduled jobs are registered."
        hint="Jobs you register with the scheduler appear here with their next run."
      />
    );

  return (
    <TableCard label="Schedules">
      <TableHeader>
        <TableRow>
          <TableHead className={HEAD}>Name</TableHead>
          <TableHead className={HEAD}>Schedule</TableHead>
          <TableHead className={HEAD}>Last run</TableHead>
          <TableHead className={HEAD}>Next run</TableHead>
          <TableHead className={`${HEAD} ${NUM_CELL}`}>Duration</TableHead>
          <TableHead className={`${HEAD} ${NUM_CELL}`}>Runs</TableHead>
          <TableHead className={`${HEAD} ${NUM_CELL}`}>Failures</TableHead>
          <TableHead className={HEAD}>Recent runs</TableHead>
          <TableHead className={HEAD}>Last error</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.schedules.map((job) => (
          <TableRow key={job.name}>
            <TableCell className="font-mono text-xs">
              {job.name} {job.isRunning ? <Pill tone="info">running</Pill> : null}
            </TableCell>
            <TableCell className="font-mono text-xs">{job.cron ?? job.interval ?? DASH}</TableCell>
            <TableCell className="text-muted-foreground">
              <Time at={job.lastRunAt} />
            </TableCell>
            <TableCell>
              <Time at={job.nextRunAt} />
            </TableCell>
            <TableCell className={NUM_CELL}>{formatMs(job.lastDurationMs)}</TableCell>
            <TableCell className={NUM_CELL}>{formatNumber(job.runs)}</TableCell>
            <TableCell className={NUM_CELL}>
              {job.failures ? (
                <Pill tone="destructive" mono>
                  {job.failures}
                </Pill>
              ) : (
                DASH
              )}
            </TableCell>
            <TableCell>
              <RecentRuns runs={job.recentRuns} />
            </TableCell>
            <TableCell className="max-w-xs text-xs whitespace-normal text-destructive">
              {job.lastError ?? DASH}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableCard>
  );
}

function Queues({ report }: { report: DevtoolsJobsReport }) {
  if (!report.available.queue) {
    return (
      <EmptyState
        title="The queue is not installed in this app. Install @warlock.js/queue to see its job counts here."
        hint="Add the package, dispatch a job and restart the app."
      />
    );
  }

  if (!report.queues.length)
    return (
      <EmptyState
        title="No queue reported job counts."
        hint="Counts appear once a queue has handled a job."
      />
    );

  const states = [...new Set(report.queues.flatMap((queue) => Object.keys(queue.counts)))];

  return (
    <TableCard label="Queues">
      <TableHeader>
        <TableRow>
          <TableHead className={HEAD}>Queue</TableHead>
          {states.length === 0 ? <TableHead className={HEAD}>Counts</TableHead> : null}
          {states.map((state) => (
            <TableHead key={state} className={`${HEAD} ${NUM_CELL}`}>
              {state}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.queues.map((queue) => (
          <TableRow key={queue.name}>
            <TableCell className="font-mono text-xs">{queue.name}</TableCell>
            {queue.countsAvailable === false ? (
              <TableCell
                colSpan={Math.max(states.length, 1)}
                className="text-xs text-muted-foreground"
              >
                Counts not available: this queue driver cannot count jobs.
              </TableCell>
            ) : null}
            {queue.countsAvailable === false
              ? null
              : states.map((state) => (
                  <TableCell
                    key={state}
                    className={`${NUM_CELL} ${state === "failed" && queue.counts[state] ? "font-semibold text-destructive" : ""}`}
                  >
                    {formatNumber(queue.counts[state] ?? 0)}
                  </TableCell>
                ))}
          </TableRow>
        ))}
      </TableBody>
    </TableCard>
  );
}

/** The Jobs tab: schedules and queue counts per instance. */
export function JobsPanel({ instance }: DevtoolsPanelProps) {
  const path = `api/jobs${queryString({ instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsJobsView>(path, { refreshMs: 10_000 });
  const reports = (data?.instances ?? []).map((entry) => entry.report);
  const schedules = reports.flatMap((report) => report.schedules);
  const running = schedules.filter((job) => job.isRunning).length;
  const failingJobs = schedules.filter((job) => job.lastError).length;
  const failedQueued = reports
    .flatMap((report) => report.queues)
    .reduce((sum, queue) => sum + (queue.counts.failed ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Scheduled jobs with their next run, and the job counts of each queue."
      >
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCwIcon />
          Refresh
        </Button>
      </PageHeader>
      {error ? (
        <ErrorMessage error={error} title="Could not load the jobs" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data && !data.instances.length ? (
        <EmptyState
          title="No instance has reported its jobs yet."
          hint="Reports arrive a few seconds after the app starts."
        />
      ) : null}
      {data?.instances.length ? (
        <StatTiles
          items={[
            { label: "Scheduled jobs", value: formatNumber(schedules.length) },
            {
              label: "Running now",
              value: formatNumber(running),
              tone: running ? "info" : "neutral",
            },
            {
              label: "Jobs with a last error",
              value: formatNumber(failingJobs),
              tone: failingJobs ? "destructive" : "success",
            },
            {
              label: "Failed queue jobs",
              value: formatNumber(failedQueued),
              tone: failedQueued ? "destructive" : "success",
            },
          ]}
        />
      ) : null}
      <div className="space-y-4">
        {data?.instances.map(({ instance: info, report }) => (
          <Card key={info.id}>
            <CardHeader>
              <CardTitle className="text-base">{info.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
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
