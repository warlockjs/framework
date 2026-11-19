import type { DevtoolsAiReportView } from "@contracts";
import {
  KpiDelta,
  StackedColumnChart,
  TimeLineChart,
  TOKEN_SERIES_COLORS,
  slotColor,
  useSeriesColors,
} from "@/components/charts";
import { PageHeader } from "@/components/listing";
import { formatNumber, SectionTitle } from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";
import { AiBanner, AiData, KpiTiles, OBSERVATION_OFF_TEXT } from "../ai-shared/AiData";
import { AiFilterRow } from "../ai-shared/AiFilterRow";
import {
  formatLatency,
  formatRatio,
  formatTokens,
  formatUsd,
  previousLabel,
} from "../ai-shared/format-ai";
import { BreakdownTable } from "../ai-shared/BreakdownTable";
import { openAiTab } from "../ai-shared/route";
import { useAiApi } from "../ai-shared/useAiApi";
import { useAiFilters } from "../ai-shared/useAiFilters";

type Report = Extract<DevtoolsAiReportView, { available: true }>;

function ReportBody({
  report,
  refreshing,
  openModel,
  openAgent,
}: {
  report: Report;
  refreshing: boolean;
  openModel: (key: string) => void;
  openAgent: () => void;
}) {
  const { totals, previous, range } = report;
  const against = previousLabel(range);
  // The previous period may be older than the kept history; then there is nothing to compare.
  const previousComplete = report.previousComplete !== false;
  const color = useSeriesColors(
    report.costByModel.series.filter((s) => !s.other).map((s) => s.key),
  );
  const unpriced = new Set(report.unpricedModels);
  const tokensSet = {
    ...report.tokens,
    series: report.tokens.series.map((series) => ({
      ...series,
      label:
        { uncached: "Uncached input", cached: "Cached input", output: "Output" }[series.key] ??
        series.label,
    })),
  };

  return (
    <>
      {report.observationOff ? <AiBanner tone="info">{OBSERVATION_OFF_TEXT}</AiBanner> : null}
      {report.unpricedModels.length ? (
        <AiBanner>
          {`${report.unpricedModels.length} ${report.unpricedModels.length === 1 ? "model has" : "models have"} no pricing; their runs are not in the cost (${report.unpricedModels.join(", ")}). Add pricing for them in the AI config to include them.`}
        </AiBanner>
      ) : null}
      <KpiTiles
        label="AI report summary"
        items={[
          {
            label: "Estimated cost",
            value: formatUsd(totals.cost.estimatedUsd),
            hint:
              totals.cost.unpricedRuns > 0
                ? `Estimated from model pricing · ${formatNumber(totals.cost.unpricedRuns)} unpriced runs`
                : "Estimated from model pricing",
            delta: (
              <KpiDelta
                current={totals.cost.estimatedUsd}
                previous={previous.cost.estimatedUsd}
                against={against}
                previousComplete={previousComplete}
              />
            ),
          },
          {
            label: "Tokens",
            value: formatTokens(totals.tokens.input + totals.tokens.output),
            hint: `${formatTokens(totals.tokens.input)} in · ${formatTokens(totals.tokens.output)} out · ${formatTokens(totals.tokens.cached)} cached`,
            delta: (
              <KpiDelta
                current={totals.tokens.input + totals.tokens.output}
                previous={previous.tokens.input + previous.tokens.output}
                against={against}
                previousComplete={previousComplete}
              />
            ),
          },
          {
            label: "Agent runs",
            value: formatNumber(totals.runs),
            delta: (
              <KpiDelta
                current={totals.runs}
                previous={previous.runs}
                against={against}
                previousComplete={previousComplete}
              />
            ),
          },
          {
            label: "Error rate",
            value: formatRatio(totals.errorRate),
            tone: previousComplete && totals.errorRate > previous.errorRate ? "warning" : "neutral",
            hint: `${formatNumber(totals.failed + totals.incomplete)} failed or incomplete`,
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
            label: "p95 latency",
            value: formatLatency(totals.latency.p95Ms),
            delta:
              totals.latency.p95Ms !== null && previous.latency.p95Ms !== null ? (
                <KpiDelta
                  current={totals.latency.p95Ms}
                  previous={previous.latency.p95Ms}
                  against={against}
                  previousComplete={previousComplete}
                  risingIsBad
                />
              ) : null,
          },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <StackedColumnChart
          title="Estimated cost by model"
          description="Estimated from model pricing; unpriced models are left out."
          set={report.costByModel}
          stepMs={range.stepMs}
          format={formatUsd}
          color={color}
          loading={refreshing}
          emptyText="No priced runs in this range."
        />
        <StackedColumnChart
          title="Tokens"
          set={tokensSet}
          stepMs={range.stepMs}
          format={formatTokens}
          color={(key) => TOKEN_SERIES_COLORS[key] ?? slotColor(1)}
          loading={refreshing}
          emptyText="No tokens used in this range."
        />
      </div>
      <div className="mt-4">
        <TimeLineChart
          title="Error rate"
          seriesName="Error rate"
          points={report.errorRate}
          stepMs={range.stepMs}
          format={formatRatio}
          color={slotColor(4)}
          loading={refreshing}
          emptyText="No runs in this range, so there is no error rate."
        />
      </div>
      <SectionTitle>Top agents</SectionTitle>
      <BreakdownTable
        label="Top agents"
        heading="Agent"
        rows={report.topAgents}
        onOpen={openAgent}
      />
      <SectionTitle>Top models</SectionTitle>
      <BreakdownTable
        label="Top models"
        heading="Model"
        rows={report.topModels}
        unpriced={unpriced}
        onOpen={(row) => openModel(row.key)}
      />
    </>
  );
}

/** Reports: totals, cost and token charts, error rate and the top agents and models of a date range. */
export function AiReportsPanel({ route, navigate }: DevtoolsPanelProps) {
  const { state, setState } = useAiFilters(route, navigate);
  const api = useAiApi<DevtoolsAiReportView>("reports", state);
  const filters = api.data?.available ? api.data.filters : undefined;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Estimated cost, tokens, errors and latency of your AI runs over a date range. Kept as hourly totals, so they survive restarts."
      />
      <AiFilterRow state={state} filters={filters} onChange={setState} />
      <AiData api={api} errorTitle="Could not load the AI report">
        {(report, refreshing) => (
          <ReportBody
            report={report}
            refreshing={refreshing}
            openModel={(model) => {
              openAiTab("ai-models", state, { model });
            }}
            openAgent={() => {
              location.hash = "#agents";
            }}
          />
        )}
      </AiData>
    </div>
  );
}
