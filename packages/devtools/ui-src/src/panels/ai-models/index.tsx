import type { DevtoolsAiModelsView } from "@contracts";
import { ShareBar, StackedColumnChart, useSeriesColors } from "@/components/charts";
import { HEAD, NUM_CELL, PageHeader, TableCard } from "@/components/listing";
import { DASH, formatNumber, SectionTitle } from "@/components/ui/panel-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DevtoolsPanelProps } from "@/panels/types";
import { AiBanner, AiData, KpiTiles, OBSERVATION_OFF_TEXT } from "../ai-shared/AiData";
import { AiFilterRow } from "../ai-shared/AiFilterRow";
import { formatLatency, formatRatio, formatTokens, formatUsd } from "../ai-shared/format-ai";
import { PricingPill } from "../ai-shared/pills";
import { useAiApi } from "../ai-shared/useAiApi";
import { useAiFilters } from "../ai-shared/useAiFilters";

type Models = Extract<DevtoolsAiModelsView, { available: true }>;

function ModelsBody({ view, refreshing }: { view: Models; refreshing: boolean }) {
  const color = useSeriesColors(view.runsByModel.series.filter((s) => !s.other).map((s) => s.key));
  // A model whose runs used no tokens has nothing to price, so it is not "unpriced".
  const unpriced = view.models.filter(
    (model) => model.pricing === "missing" || model.pricing === "partial",
  ).length;
  const maxCost = Math.max(0, ...view.models.map((model) => model.totals.cost.estimatedUsd));

  return (
    <>
      {view.observationOff ? <AiBanner tone="info">{OBSERVATION_OFF_TEXT}</AiBanner> : null}
      <KpiTiles
        label="Models summary"
        items={[
          { label: "Models used", value: formatNumber(view.models.length) },
          {
            label: "Estimated cost",
            value: formatUsd(view.totals.cost.estimatedUsd),
            hint: "Estimated from model pricing",
          },
          {
            label: "Unpriced models",
            value: formatNumber(unpriced),
            tone: unpriced ? "warning" : "neutral",
            hint: unpriced ? "Their runs are not in the cost" : "Every model has pricing",
          },
          {
            label: "Fallback rate",
            value: formatRatio(view.totals.runs ? view.totals.fallbackRuns / view.totals.runs : 0),
            hint: `${formatNumber(view.totals.fallbackRuns)} runs answered by a fallback model`,
          },
        ]}
      />
      <StackedColumnChart
        title="Runs by model"
        set={view.runsByModel}
        stepMs={view.range.stepMs}
        format={formatNumber}
        color={color}
        loading={refreshing}
        emptyText="No runs in this range."
      />
      <SectionTitle>Models</SectionTitle>
      {view.models.length ? (
        <TableCard label="Models">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Model</TableHead>
              <TableHead className={HEAD}>Provider</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Runs</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Tokens in</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Tokens out</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Estimated cost</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Cost per run</TableHead>
              <TableHead className={HEAD}>Pricing</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Fallback</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Error rate</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>p50 / p95</TableHead>
              <TableHead className={HEAD}>Agents</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.models.map((model) => (
              <TableRow key={model.key}>
                <TableCell className="max-w-56 truncate font-medium">{model.model}</TableCell>
                <TableCell className="text-muted-foreground">{model.provider}</TableCell>
                <TableCell className={NUM_CELL}>{formatNumber(model.totals.runs)}</TableCell>
                <TableCell className={NUM_CELL}>
                  {formatTokens(model.totals.tokens.input)}
                </TableCell>
                <TableCell className={NUM_CELL}>
                  {formatTokens(model.totals.tokens.output)}
                </TableCell>
                <TableCell className={NUM_CELL}>
                  {model.pricing === "missing" || model.pricing === "no-tokens" ? (
                    DASH
                  ) : (
                    <ShareBar share={maxCost > 0 ? model.totals.cost.estimatedUsd / maxCost : 0}>
                      {formatUsd(model.totals.cost.estimatedUsd)}
                    </ShareBar>
                  )}
                </TableCell>
                <TableCell className={NUM_CELL}>
                  {model.costPerRunUsd === null ? DASH : formatUsd(model.costPerRunUsd)}
                </TableCell>
                <TableCell>
                  <PricingPill state={model.pricing} />
                </TableCell>
                <TableCell className={NUM_CELL}>{formatRatio(model.fallbackRate)}</TableCell>
                <TableCell className={NUM_CELL}>{formatRatio(model.totals.errorRate)}</TableCell>
                <TableCell className={NUM_CELL}>
                  {`${formatLatency(model.totals.latency.p50Ms)} / ${formatLatency(model.totals.latency.p95Ms)}`}
                </TableCell>
                <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                  {model.agents.join(", ") || DASH}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      ) : (
        <p className="text-sm text-muted-foreground">No models used in this range.</p>
      )}
    </>
  );
}

/** Models: which models ran, what they cost, whether they have pricing, and how often a fallback answered. */
export function AiModelsPanel({ route, navigate }: DevtoolsPanelProps) {
  const { state, setState } = useAiFilters(route, navigate);
  const api = useAiApi<DevtoolsAiModelsView>("models", state);
  const filters = api.data?.available ? api.data.filters : undefined;

  return (
    <div>
      <PageHeader
        title="Models"
        description="Every model your AI runs used in the date range, with its cost, pricing state, latency and error rate."
      />
      <AiFilterRow state={state} filters={filters} onChange={setState} />
      <AiData api={api} errorTitle="Could not load the models">
        {(view, refreshing) => <ModelsBody view={view} refreshing={refreshing} />}
      </AiData>
    </div>
  );
}
