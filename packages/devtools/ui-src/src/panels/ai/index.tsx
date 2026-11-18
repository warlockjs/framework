import { useCallback, useState } from "react";
import { useApi, useStream } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  BackButton,
  FilterBar,
  PageHeader,
  Pill,
  StatTiles,
  type PillTone,
} from "@/components/listing";
import {
  DASH,
  formatCost,
  formatNumber,
  Json,
  RowButton,
  TextField,
} from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";
import type { AiAnswer, AiRun, AiSpanNode, AiTrace, AiUsage } from "./types";

const AI_GUIDANCE =
  "Install @warlock.js/ai and @warlock.js/ai-panoptic, restart warlock dev, and enable Panoptic observation.";

export function runTone(status: string): PillTone {
  if (status === "completed" || status === "ok") return "success";
  if (status === "incomplete") return "warning";
  if (status === "error" || status === "failed") return "destructive";

  return "neutral";
}

const value = (item: number | null | undefined) => (item == null ? DASH : String(item));

export function aiUsageText(usage: AiUsage, cost: number | undefined): string {
  const semantics =
    usage.inputIncludesCache === false
      ? "input excludes cache tokens"
      : "input includes cache tokens";

  return `${value(usage.input)} input · ${value(usage.output)} output · ${value(usage.cachedTokens)} cache read · ${value(usage.cacheWriteTokens)} cache write · ${formatCost(cost)} (${semantics})`;
}

export function AiRunSummary({ run }: { run: AiRun }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Pill tone={runTone(run.status)}>{run.status}</Pill>
        <span className="text-xs text-muted-foreground">{run.traceId.slice(0, 8)}</span>
      </div>
      <div className="font-medium break-words">
        {`${run.name} · ${run.status}${run.incomplete ? " · Incomplete / truncated" : ""} · ${run.duration} ms`}
      </div>
      <div className="text-xs text-muted-foreground break-words">
        {run.models.join(", ") || "Model unreported"}
      </div>
      <p className="text-sm">{aiUsageText(run.usage, run.cost)}</p>
      <div className="text-xs text-muted-foreground">
        {`${run.toolCalls} tool calls · ${run.retries} retries · ${value(run.cacheHits)} provider cache-hit trips · ${run.truncatedTrips} truncated trips · ${run.compactions} applied / ${run.skippedCompactions} skipped compactions · ${run.providerCompactions} provider compactions`}
      </div>
      <div className="text-xs text-muted-foreground">
        {`${run.traceId} · ${run.requestId ? `Request ${run.requestId}` : "Background / no request id"}`}
      </div>
    </div>
  );
}

function AiSpan({ span, rootStartedAt }: { span: AiSpanNode; rootStartedAt: string }) {
  const incomplete =
    span.status === "incomplete" ||
    span.error?.type === "AgentIncompleteError" ||
    span.error?.type === "AGENT_INCOMPLETE";
  const start = Date.parse(span.startedAt) - Date.parse(rootStartedAt);

  return (
    <details open className="ml-3 border-l-2 pl-2">
      <summary className="cursor-pointer text-sm">
        {`${span.type} ${span.name} · ${span.status}${incomplete ? " · Incomplete / truncated" : ""} · +${start} ms · ${span.duration} ms`}
      </summary>
      <p className="text-xs text-muted-foreground">{`${span.startedAt} → ${span.endedAt}`}</p>
      <Json value={{ usage: span.usage, attributes: span.attributes, error: span.error }} />
      {span.children.map((child, index) => (
        <AiSpan key={`${child.name}-${index}`} span={child} rootStartedAt={rootStartedAt} />
      ))}
    </details>
  );
}

function RunDetail({
  run,
  traceId,
  onClose,
}: {
  run: AiRun | undefined;
  traceId: string;
  onClose: () => void;
}) {
  const { data, error, loading, reload } = useApi<AiTrace>(
    `api/ai/runs/${encodeURIComponent(traceId)}`,
  );

  return (
    <section aria-label="AI run detail" className="space-y-3 rounded-xl border bg-card p-3.5">
      <BackButton onClick={onClose}>Close run</BackButton>
      {run ? <AiRunSummary run={run} /> : null}
      {run?.requestId ? (
        <a
          className="inline-block rounded-md border px-3 py-1 text-sm hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          href={`#requests/${encodeURIComponent(run.requestId)}`}
        >
          Open HTTP request
        </a>
      ) : null}
      {error ? (
        <ErrorMessage error={error} title="Could not load this run's spans" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows rows={3} /> : null}
      {data ? <AiSpan span={data.root} rootStartedAt={data.startedAt} /> : null}
    </section>
  );
}

/** The AI tab: Panoptic runs with usage, cost, retries, compaction and the span tree. */
export function AiPanel({ route, navigate }: DevtoolsPanelProps) {
  const [requestId, setRequestId] = useState("");
  const [applied, setApplied] = useState("");
  const path = `api/ai${applied ? `?requestId=${encodeURIComponent(applied)}` : ""}`;
  const { data, error, loading, reload } = useApi<AiAnswer>(path);

  useStream(
    ["ai"],
    useCallback(() => reload(), [reload]),
  );

  const costs = data?.runs.filter((run) => run.cost != null) ?? [];
  const selected = data?.runs.find((run) => run.traceId === route);

  const runs = data?.runs ?? [];

  return (
    <div>
      <PageHeader
        title="AI runs"
        description="Every AI run your app made: tokens, cost, retries and the span tree of each one."
      />
      <FilterBar
        label="AI run filters"
        onSubmit={() => {
          setApplied(requestId.trim());
          navigate("");
          reload();
        }}
      >
        <TextField
          placeholder="HTTP request id (empty for all runs)"
          aria-label="Filter AI runs by HTTP request id"
          className="w-72 max-w-full"
          value={requestId}
          onChange={(event) => setRequestId(event.target.value)}
        />
        <Button type="submit" size="sm">
          Filter / refresh
        </Button>
      </FilterBar>
      {error ? (
        <ErrorMessage error={error} title="Could not load the AI runs" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.available ? (
        <EmptyState
          title={data.message || AI_GUIDANCE}
          hint="AI observation needs the Panoptic package; nothing else to configure."
        />
      ) : null}
      {data?.available && !data.runs.length ? (
        <EmptyState
          title="No AI runs yet. Enable Panoptic observation and execute a flow; runs appear when collection completes."
          hint={
            applied ? "This request id has no runs. Clear the filter to see all runs." : undefined
          }
        />
      ) : null}
      {data?.available && data.runs.length ? (
        <>
          <StatTiles
            items={[
              { label: "Runs", value: formatNumber(runs.length) },
              {
                label: "Tool calls",
                value: formatNumber(runs.reduce((sum, run) => sum + run.toolCalls, 0)),
              },
              {
                label: "Retried attempts",
                value: formatNumber(runs.reduce((sum, run) => sum + run.retries, 0)),
                tone: runs.some((run) => run.retries) ? "warning" : "neutral",
              },
              {
                label: "Incomplete runs",
                value: formatNumber(runs.filter((run) => run.incomplete).length),
                tone: runs.some((run) => run.incomplete) ? "warning" : "success",
              },
            ]}
          />
          {data.aggregate ? (
            <p className="mb-3 text-sm text-muted-foreground">
              {`${data.aggregate.traces} runs · ${data.aggregate.usage.input} input tokens · ${data.aggregate.usage.output} output tokens · ${
                costs.length
                  ? `$${costs.reduce((sum, run) => sum + (run.cost ?? 0), 0).toFixed(6)} USD (reported cost)`
                  : "unpriced"
              }`}
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="min-w-0 space-y-1.5">
              {data.runs.map((run) => (
                <RowButton
                  key={run.traceId}
                  selected={run.traceId === route}
                  className="rounded-xl bg-card p-3"
                  onClick={() => navigate(run.traceId)}
                >
                  <AiRunSummary run={run} />
                </RowButton>
              ))}
            </div>
            <div className="min-w-0">
              {route ? (
                <RunDetail
                  key={route}
                  run={selected}
                  traceId={route}
                  onClose={() => navigate("")}
                />
              ) : (
                <EmptyState
                  title="Select a run to inspect tools, retries and compaction metadata."
                  hint="Its span tree opens here."
                />
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
