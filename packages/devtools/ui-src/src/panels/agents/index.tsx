import { useCallback, useState } from "react";
import { useApi, useStream } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import {
  Code,
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
import type { AgentRun, AgentRunsAnswer, AgentToolCall, AgentTraceDetail, AgentTurn } from "./types";

const value = (item: number | string | null | undefined) => (item == null ? DASH : String(item));

function AgentRunSummary({ run }: { run: AgentRun }) {
  return (
    <div className="space-y-1">
      <div className="font-medium">{`${run.agent} · ${run.status} · ${value(run.durationMs)} ms`}</div>
      <div className="text-xs text-muted-foreground break-words">{run.model}</div>
      <p className="text-sm">
        {`${run.turns} turns · ${run.toolCalls} tool calls · ${run.refusals} refused · ${run.usage.input} input · ${run.usage.output} output · ${formatCost(run.cost)}`}
      </p>
      <div className="text-xs text-muted-foreground">
        {`${run.runId}${run.requestId ? ` · Request ${run.requestId}` : ""}`}
      </div>
    </div>
  );
}

function ToolCall({ call }: { call: AgentToolCall }) {
  const line = [
    `${call.name} · ${call.status} · ${call.durationMs} ms`,
    ...(call.refusal ? [`refused: ${call.refusal}`] : []),
    ...(call.error ? [`error: ${call.error.message}`] : []),
  ].join(" · ");

  return (
    <details open={Boolean(call.refusal || call.error)} className="ml-3 border-l pl-2">
      <summary className="cursor-pointer text-sm">{line}</summary>
      <Json value={{ input: call.input, output: call.output }} />
    </details>
  );
}

function Turn({ turn }: { turn: AgentTurn }) {
  const tokens = turn.toolsOffered.reduce((sum, tool) => sum + tool.tokens, 0);
  const cost = turn.cost == null ? "" : ` · ${formatCost(turn.cost)}`;

  return (
    <details open className="rounded-md border p-2">
      <summary className="cursor-pointer text-sm font-medium">
        {`turn ${turn.index} · ${value(turn.finishReason)} · ${Math.round(turn.durationMs)} ms · ${turn.usage.input} input · ${turn.usage.output} output${cost}`}
      </summary>
      <p className="text-xs text-muted-foreground">
        {`starts from ${turn.input} · system prompt ${value(turn.systemPromptHash)} · tools ${turn.toolsHash}`}
      </p>
      <p className="text-xs text-muted-foreground">
        {`Tools offered (~${tokens} tokens): ${turn.toolsOffered.map((tool) => `${tool.name}@${tool.schemaHash.slice(0, 8)}`).join(", ") || "none"}`}
      </p>
      {turn.text ? <Code>{turn.text}</Code> : null}
      {turn.toolCalls.map((call, index) => (
        <ToolCall key={index} call={call} />
      ))}
      {turn.contract.map((event, index) => (
        <p key={index} className="text-xs text-muted-foreground">
          {`contract: ${event.type}${event.tool ? ` ${event.tool}` : ""}${event.name ? ` ${event.name}` : ""}${event.reason ? ` (${event.reason})` : ""}`}
        </p>
      ))}
      {turn.error ? <p className="text-sm text-destructive">{turn.error.message}</p> : null}
    </details>
  );
}

/** Compares the prompt and tool definitions of a run with the previous run of the same agent. */
export function agentDiffText(trace: AgentTraceDetail, previous: AgentTraceDetail | undefined): string {
  if (!previous) return "No earlier run of this agent to compare with.";

  const tools = (item: AgentTraceDetail) =>
    new Map(item.turns.flatMap((turn) => turn.toolsOffered).map((tool) => [tool.name, tool.schemaHash] as const));
  const now = tools(trace);
  const before = tools(previous);
  const changed = [...now].filter(([name, hash]) => before.has(name) && before.get(name) !== hash);
  const added = [...now.keys()].filter((name) => !before.has(name));
  const removed = [...before.keys()].filter((name) => !now.has(name));
  const prompt = trace.systemPrompt?.hash === previous.systemPrompt?.hash ? "same" : "changed";
  const identical = prompt === "same" && !changed.length && !added.length && !removed.length;

  return identical
    ? `Same system prompt and tool definitions as ${previous.runId}.`
    : `Against ${previous.runId}: system prompt ${prompt}; tools changed: ${changed.map(([name]) => name).join(", ") || "none"}; added: ${added.join(", ") || "none"}; removed: ${removed.join(", ") || "none"}.`;
}

function RunDetail({ run, earlier }: { run: AgentRun; earlier: AgentRun | undefined }) {
  const { data: trace, error, loading, reload } = useApi<AgentTraceDetail>(
    `api/ai/agent-runs/${encodeURIComponent(run.runId)}`,
  );
  const previous = useApi<AgentTraceDetail>(earlier ? `api/ai/agent-runs/${encodeURIComponent(earlier.runId)}` : null);
  const comparing = Boolean(earlier) && !previous.data && !previous.error;

  return (
    <section aria-label="Agent run detail" className="space-y-2">
      <AgentRunSummary run={run} />
      {error ? <ErrorMessage error={error} title="Could not load this agent run" onRetry={reload} /> : null}
      {!trace && loading ? <LoadingRows rows={3} /> : null}
      {trace ? (
        <>
          <p className="text-xs text-muted-foreground">{`Input: ${trace.input}`}</p>
          {trace.systemPrompt ? (
            <details>
              <summary className="cursor-pointer text-sm">{`System prompt ${trace.systemPrompt.hash}`}</summary>
              <Code>{trace.systemPrompt.text ?? "Text not kept (only the hash is recorded)."}</Code>
            </details>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {comparing ? "Comparing with the earlier run…" : agentDiffText(trace, previous.data)}
          </p>
          {Object.entries(trace.toolSchemas).map(([hash, schema]) => (
            <details key={hash}>
              <summary className="cursor-pointer text-sm">{`Tool ${schema.name}@${hash.slice(0, 8)}`}</summary>
              <Code>{`${schema.description}\n\n${schema.schema ?? "Schema not kept."}`}</Code>
            </details>
          ))}
          {trace.turns.map((turn) => (
            <Turn key={turn.index} turn={turn} />
          ))}
          {trace.error ? <p className="text-sm text-destructive">{trace.error.message}</p> : null}
        </>
      ) : null}
    </section>
  );
}

/** The Agents tab: agent run traces with prompt, tools, turns, calls and refusals. */
export function AgentsPanel({ route, navigate }: DevtoolsPanelProps) {
  const [requestId, setRequestId] = useState("");
  const [applied, setApplied] = useState("");
  const path = `api/ai/agent-runs${applied ? `?requestId=${encodeURIComponent(applied)}` : ""}`;
  const { data, error, loading, reload } = useApi<AgentRunsAnswer>(path);

  useStream(["agent-trace"], useCallback(() => reload(), [reload]));

  const selected = data?.runs.find((run) => run.runId === route);
  const earlier = selected && data ? data.runs.slice(data.runs.indexOf(selected) + 1).find((run) => run.agent === selected.agent) : undefined;

  return (
    <div>
      <PanelHeader title="Agent runs" />
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
          aria-label="Filter agent runs by HTTP request id"
          className="w-72"
          value={requestId}
          onChange={(event) => setRequestId(event.target.value)}
        />
        <Button type="submit" size="sm">
          Filter / refresh
        </Button>
      </form>
      {error ? <ErrorMessage error={error} title="Could not load the agent runs" onRetry={reload} /> : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.available ? <EmptyState>{data.message || "No agent traces yet."}</EmptyState> : null}
      {data?.available && !data.runs.length ? (
        <EmptyState>No agent runs yet. Execute an agent in development; runs appear as turns finish.</EmptyState>
      ) : null}
      {data?.available && data.runs.length ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-1">
            {data.runs.map((run) => (
              <RowButton key={run.runId} selected={run.runId === route} onClick={() => navigate(run.runId)}>
                <AgentRunSummary run={run} />
              </RowButton>
            ))}
          </div>
          <div>
            {selected ? (
              <RunDetail key={selected.runId} run={selected} earlier={earlier} />
            ) : (
              <EmptyState>Select a run to inspect its prompt, tools, calls and refusals.</EmptyState>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
