import type { DevtoolsAiErrorsView } from "@contracts";
import { KpiDelta, ShareBar, StackedColumnChart, useSeriesColors } from "@/components/charts";
import { HEAD, NUM_CELL, PageHeader, Pill, TableCard } from "@/components/listing";
import { DASH, formatNumber, SectionTitle, Time } from "@/components/ui/panel-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DevtoolsPanelProps } from "@/panels/types";
import { AiBanner, AiData, KpiTiles, OBSERVATION_OFF_TEXT } from "../ai-shared/AiData";
import { AiFilterRow } from "../ai-shared/AiFilterRow";
import { formatRatio, previousLabel } from "../ai-shared/format-ai";
import { useAiApi } from "../ai-shared/useAiApi";
import { useAiFilters } from "../ai-shared/useAiFilters";

type Errors = Extract<DevtoolsAiErrorsView, { available: true }>;

const top = (items: { key: string; count: number }[]) =>
  items.map((item) => `${item.key} (${item.count})`).join(", ") || DASH;

function ErrorsBody({ view, refreshing }: { view: Errors; refreshing: boolean }) {
  // Categories keep their own colour slots, so visiting Errors never repaints the models on Reports.
  const color = useSeriesColors(
    view.overTime.series.filter((s) => !s.other).map((s) => s.key),
    "errors",
  );
  const { totals, previous } = view;
  const against = previousLabel(view.range);
  const failed = totals.failed + totals.incomplete;
  const failedBefore = previous.failed + previous.incomplete;
  // The previous period may be older than the kept history; then there is nothing to compare.
  const previousComplete = view.previousComplete !== false;

  return (
    <>
      {view.observationOff ? <AiBanner tone="info">{OBSERVATION_OFF_TEXT}</AiBanner> : null}
      <KpiTiles
        label="Errors summary"
        items={[
          {
            label: "Failed runs",
            value: formatNumber(failed),
            tone: failed ? "warning" : "neutral",
            hint: "Failed plus incomplete",
            delta: (
              <KpiDelta
                current={failed}
                previous={failedBefore}
                against={against}
                previousComplete={previousComplete}
                risingIsBad
              />
            ),
          },
          {
            label: "Error rate",
            value: formatRatio(totals.errorRate),
            delta: (
              <KpiDelta
                current={totals.errorRate}
                previous={previous.errorRate}
                against={against}
                previousComplete={previousComplete}
                risingIsBad
              />
            ),
          },
          {
            label: "Refusals",
            value: formatNumber(totals.refusals),
            hint: "Provider refused or filtered",
          },
          {
            label: "Cancelled",
            value: formatNumber(totals.cancelled),
            hint: "Not counted as errors",
          },
        ]}
      />
      <StackedColumnChart
        title="Failed runs by category"
        set={view.overTime}
        stepMs={view.range.stepMs}
        format={formatNumber}
        color={color}
        loading={refreshing}
        emptyText="No failed runs in this range."
      />
      <SectionTitle>Categories</SectionTitle>
      {view.groups.length ? (
        <TableCard label="Failed runs by category">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Category</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Runs</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Change</TableHead>
              <TableHead className={HEAD}>Top models</TableHead>
              <TableHead className={HEAD}>Top agents</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.groups.map((group) => (
              <TableRow key={group.category}>
                <TableCell className="font-medium">{group.label}</TableCell>
                <TableCell className={NUM_CELL}>
                  <ShareBar share={group.share}>{formatNumber(group.count)}</ShareBar>
                </TableCell>
                <TableCell className={NUM_CELL}>
                  <KpiDelta
                    current={group.count}
                    previous={group.previousCount}
                    against="previous period"
                    previousComplete={previousComplete}
                    risingIsBad
                  />
                </TableCell>
                <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                  {top(group.byModel)}
                </TableCell>
                <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                  {top(group.byAgent)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      ) : (
        <p className="text-sm text-muted-foreground">No failed runs in this range.</p>
      )}
      <SectionTitle>Recent failed runs</SectionTitle>
      {view.recent === null ? (
        <p className="text-sm text-muted-foreground">
          Production keeps hourly totals, not run details. Open Runs in development (warlock dev) to
          see the failed runs themselves.
        </p>
      ) : view.recent.length ? (
        <TableCard label="Recent failed runs">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>When</TableHead>
              <TableHead className={HEAD}>Agent</TableHead>
              <TableHead className={HEAD}>Model</TableHead>
              <TableHead className={HEAD}>Category</TableHead>
              <TableHead className={HEAD}>Error</TableHead>
              <TableHead className={HEAD}>Run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.recent.map((run, index) => (
              // One trace can hold several failed agent spans, so the trace id alone is not unique.
              <TableRow key={`${run.traceId}:${index}`}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <Time at={run.endedAt} />
                </TableCell>
                <TableCell className="font-medium">{run.agent}</TableCell>
                <TableCell className="text-muted-foreground">{run.model ?? DASH}</TableCell>
                <TableCell>
                  <Pill tone="destructive">{run.category}</Pill>
                </TableCell>
                <TableCell className="max-w-md text-xs whitespace-normal break-words">
                  {run.code ? <span className="font-mono">{run.code}</span> : null}
                  {run.message ? (
                    <span className="block text-muted-foreground">{run.message}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <a
                    className="text-brand underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    href={`#ai/${encodeURIComponent(run.traceId)}`}
                  >
                    Open run
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      ) : (
        <p className="text-sm text-muted-foreground">No recent failed runs are kept in memory.</p>
      )}
    </>
  );
}

/** Errors: failed AI runs by category, over time, with the models and agents behind them. */
export function AiErrorsPanel({ route, navigate }: DevtoolsPanelProps) {
  const { state, setState } = useAiFilters(route, navigate);
  const api = useAiApi<DevtoolsAiErrorsView>("errors", state);
  const filters = api.data?.available ? api.data.filters : undefined;

  return (
    <div>
      <PageHeader
        title="Errors"
        description="Failed and incomplete AI runs grouped by what went wrong: rate limits, timeouts, refusals, provider errors and more."
      />
      <AiFilterRow state={state} filters={filters} onChange={setState} />
      <AiData api={api} errorTitle="Could not load the AI errors">
        {(view, refreshing) => <ErrorsBody view={view} refreshing={refreshing} />}
      </AiData>
    </div>
  );
}
