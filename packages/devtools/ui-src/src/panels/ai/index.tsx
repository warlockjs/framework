import { useCallback, useState } from "react";
import { useApi, useStream } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import {
  DASH,
  EmptyState,
  ErrorMessage,
  formatCost,
  Json,
  LoadingRows,
  PanelHeader,
  RowButton,
  TextField,
} from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";
import type { AiAnswer, AiRun, AiSpanNode, AiTrace, AiUsage } from "./types";

const AI_GUIDANCE =
  "Install @warlock.js/ai and @warlock.js/ai-panoptic, restart warlock dev, and enable Panoptic observation.";

const value = (item: number | null | undefined) => (item == null ? DASH : String(item));

export function aiUsageText(usage: AiUsage, cost: number | undefined): string {
  const semantics = usage.inputIncludesCache === false ? "input excludes cache tokens" : "input includes cache tokens";

  return `${value(usage.input)} input · ${value(usage.output)} output · ${value(usage.cachedTokens)} cache read · ${value(usage.cacheWriteTokens)} cache write · ${formatCost(cost)} (${semantics})`;
}

export function AiRunSummary({ run }: { run: AiRun }) {
  return (
    <div className="space-y-1">
      <div className="font-medium break-words">
        {`${run.name} · ${run.status}${run.incomplete ? " · Incomplete / truncated" : ""} · ${run.duration} ms`}
      </div>
      <div className="text-xs text-muted-foreground break-words">{run.models.join(", ") || "Model unreported"}</div>
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
    span.status === "incomplete" || span.error?.type === "AgentIncompleteError" || span.error?.type === "AGENT_INCOMPLETE";
  const start = Date.parse(span.startedAt) - Date.parse(rootStartedAt);

  return (
    <details open className="ml-3 border-l pl-2">
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

function RunDetail({ run, traceId }: { run: AiRun | undefined; traceId: string }) {
  const { data, error, loading, reload } = useApi<AiTrace>(`api/ai/runs/${encodeURIComponent(traceId)}`);

  return (
    <section aria-label="AI run detail" className="space-y-3">
      {run ? <AiRunSummary run={run} /> : null}
      {run?.requestId ? (
        <a className="inline-block rounded-md border px-3 py-1 text-sm hover:bg-muted/60" href={`#requests/${encodeURIComponent(run.requestId)}`}>
          Open HTTP request
        </a>
      ) : null}
      {error ? <ErrorMessage error={error} title="Could not load this run's spans" onRetry={reload} /> : null}
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

  useStream(["ai"], useCallback(() => reload(), [reload]));

  const costs = data?.runs.filter((run) => run.cost != null) ?? [];
  const selected = data?.runs.find((run) => run.traceId === route);

  return (
    <div>
      <PanelHeader title="AI runs" />
      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(requestId.trim());
          navigate("");
          reload();
        }}
      >
        <TextField
          placeholder="HTTP request id (empty for all runs)"
          aria-label="Filter AI runs by HTTP request id"
          className="w-72"
          value={requestId}
          onChange={(event) => setRequestId(event.target.value)}
        />
        <Button type="submit" size="sm">
          Filter / refresh
        </Button>
      </form>
      {error ? <ErrorMessage error={error} title="Could not load the AI runs" onRetry={reload} /> : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.available ? <EmptyState>{data.message || AI_GUIDANCE}</EmptyState> : null}
      {data?.available && !data.runs.length ? (
        <EmptyState>No AI runs yet. Enable Panoptic observation and execute a flow; runs appear when collection completes.</EmptyState>
      ) : null}
      {data?.available && data.runs.length ? (
        <>
          {data.aggregate ? (
            <p className="mb-3 text-sm">
              {`${data.aggregate.traces} runs · ${data.aggregate.usage.input} input tokens · ${data.aggregate.usage.output} output tokens · ${
                costs.length ? `$${costs.reduce((sum, run) => sum + (run.cost ?? 0), 0).toFixed(6)} USD (reported cost)` : "unpriced"
              }`}
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="space-y-1">
              {data.runs.map((run) => (
                <RowButton key={run.traceId} selected={run.traceId === route} onClick={() => navigate(run.traceId)}>
                  <AiRunSummary run={run} />
                </RowButton>
              ))}
            </div>
            <div>
              {route ? (
                <RunDetail key={route} run={selected} traceId={route} />
              ) : (
                <EmptyState>Select a run to inspect tools, retries and compaction metadata.</EmptyState>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
