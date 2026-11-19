import { useCallback, useState } from "react";
import type {
  DevtoolsAiRunGroup,
  DevtoolsAiRunRow,
  DevtoolsAiRunsView,
  DevtoolsAiUsageView,
} from "@contracts";
import { useApi, useStream } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  BackButton,
  FilterBar,
  HEAD,
  NUM_CELL,
  PageHeader,
  Pill,
  rowOpen,
  SearchField,
  StatTiles,
  TableCard,
  type PillTone,
} from "@/components/listing";
import { DASH, formatNumber, Json, RowButton, SelectField } from "@/components/ui/panel-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DevtoolsPanelProps } from "@/panels/types";
import { AiUnavailable } from "../ai-shared/AiUnavailable";
import { formatLatency, formatUsd } from "../ai-shared/format-ai";
import { NoPricingPill } from "../ai-shared/pills";
import { heatBackground, maxSpanCost, spanCostUsd } from "./cost-heat";
import type { AiSpanNode, AiTrace } from "./types";

export function runTone(status: string): PillTone {
  if (status === "completed" || status === "ok") return "success";
  if (status === "incomplete") return "warning";
  if (status === "error" || status === "failed") return "destructive";

  return "neutral";
}

const value = (item: number | null | undefined) => (item == null ? DASH : String(item));

export function aiUsageText(usage: DevtoolsAiUsageView, cost: number | null | undefined): string {
  const semantics =
    usage.inputIncludesCache === false
      ? "input excludes cache tokens"
      : "input includes cache tokens";

  return `${value(usage.input)} input · ${value(usage.output)} output · ${value(usage.cachedTokens)} cache read · ${value(usage.cacheWriteTokens)} cache write · ${cost == null ? "no pricing" : `${formatUsd(cost)} estimated`} (${semantics})`;
}

export function AiRunSummary({ run }: { run: DevtoolsAiRunRow }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={runTone(run.status)}>{run.status}</Pill>
        <span className="text-xs text-muted-foreground">{run.traceId.slice(0, 8)}</span>
        {run.cost === null && run.usage.total > 0 ? <NoPricingPill /> : null}
      </div>
      <div className="font-medium break-words">
        {`${run.name} · ${run.status}${run.incomplete ? " · Incomplete / truncated" : ""} · ${run.duration} ms`}
      </div>
      <div className="text-xs text-muted-foreground break-words">
        {run.models.join(", ") || "Model unreported"}
      </div>
      <p className="text-sm">{aiUsageText(run.usage, run.cost)}</p>
      <div className="text-xs text-muted-foreground">
        {`${run.toolCalls} tool calls · ${run.retries} retries${run.promptKey ? ` · prompt ${run.promptKey}` : ""}`}
      </div>
      <div className="text-xs text-muted-foreground">
        {`${run.traceId} · ${run.requestId ? `Request ${run.requestId}` : "Background / no request id"}`}
      </div>
    </div>
  );
}

function AiSpan({
  span,
  rootStartedAt,
  maxCost,
}: {
  span: AiSpanNode;
  rootStartedAt: string;
  maxCost: number;
}) {
  const incomplete =
    span.status === "incomplete" ||
    span.error?.type === "AgentIncompleteError" ||
    span.error?.type === "AGENT_INCOMPLETE";
  const start = Date.parse(span.startedAt) - Date.parse(rootStartedAt);
  const cost = spanCostUsd(span);

  return (
    <details open className="ml-3 border-l-2 pl-2">
      <summary
        className="cursor-pointer rounded-sm px-1 text-sm"
        style={{ background: heatBackground(cost, maxCost) }}
      >
        {`${span.type} ${span.name} · ${span.status}${incomplete ? " · Incomplete / truncated" : ""} · +${start} ms · ${span.duration} ms`}
        {cost !== null ? (
          <span className="ml-2 tabular-nums text-muted-foreground">{`· ${formatUsd(cost)} estimated`}</span>
        ) : null}
      </summary>
      <p className="text-xs text-muted-foreground">{`${span.startedAt} → ${span.endedAt}`}</p>
      <Json value={{ usage: span.usage, attributes: span.attributes, error: span.error }} />
      {span.children.map((child, index) => (
        <AiSpan
          key={`${child.name}-${index}`}
          span={child}
          rootStartedAt={rootStartedAt}
          maxCost={maxCost}
        />
      ))}
    </details>
  );
}

function RunDetail({
  run,
  traceId,
  onClose,
}: {
  run: DevtoolsAiRunRow | undefined;
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
      {data ? (
        <AiSpan span={data.root} rootStartedAt={data.startedAt} maxCost={maxSpanCost(data.root)} />
      ) : null}
    </section>
  );
}

type Filters = {
  q: string;
  requestId: string;
  status: string;
  type: string;
  session: string;
  prompt: string;
  groupBy: string;
};

const NO_FILTERS: Filters = {
  q: "",
  requestId: "",
  status: "",
  type: "",
  session: "",
  prompt: "",
  groupBy: "",
};

function runsPath(filters: Filters): string {
  const params = new URLSearchParams();

  for (const [key, item] of Object.entries(filters)) if (item.trim()) params.set(key, item.trim());

  const query = params.toString();

  return `api/ai/runs${query ? `?${query}` : ""}`;
}

/** The filter a group row applies: its key becomes the session, prompt or type filter. */
function groupFilter(groupBy: string, group: DevtoolsAiRunGroup): Partial<Filters> {
  return groupBy === "session"
    ? { session: group.key }
    : groupBy === "prompt"
      ? { prompt: group.key }
      : { type: group.key };
}

/** The Runs page: Panoptic runs with usage, estimated cost, retries and the span tree. */
export function AiPanel({ route, navigate }: DevtoolsPanelProps) {
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const { data, error, loading, reload } = useApi<DevtoolsAiRunsView>(runsPath(applied));

  useStream(
    ["ai"],
    useCallback(() => reload(), [reload]),
  );

  const apply = (next: Filters) => {
    setDraft(next);
    setApplied(next);
    navigate("");
  };
  const filtered = Object.values(applied).some(Boolean);
  const runs = data?.available ? data.runs : [];
  const selected = runs.find((run) => run.traceId === route);

  return (
    <div>
      <PageHeader
        title="Runs"
        description="Every AI run your app made: tokens, estimated cost, retries and the span tree of each one."
      />
      <FilterBar
        label="AI run filters"
        onSubmit={() => apply(draft)}
        trailing={
          filtered ? (
            <Button type="button" size="xs" variant="ghost" onClick={() => apply(NO_FILTERS)}>
              Clear filters
            </Button>
          ) : undefined
        }
      >
        <SearchField
          label="Search AI runs"
          placeholder="Search runs"
          value={draft.q}
          onChange={(event) => setDraft({ ...draft, q: event.target.value })}
        />
        <SearchField
          label="HTTP request id"
          placeholder="Request id"
          value={draft.requestId}
          onChange={(event) => setDraft({ ...draft, requestId: event.target.value })}
        />
        <SelectField
          aria-label="Status"
          value={draft.status}
          onChange={(event) => apply({ ...draft, status: event.target.value })}
        >
          <option value="">Any status</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="incomplete,max-iterations">Incomplete</option>
        </SelectField>
        <SelectField
          aria-label="Type"
          value={draft.type}
          onChange={(event) => apply({ ...draft, type: event.target.value })}
        >
          <option value="">Any type</option>
          <option value="agent">Agent</option>
          <option value="workflow">Workflow</option>
          <option value="supervisor">Supervisor</option>
        </SelectField>
        <SelectField
          aria-label="Group by"
          value={draft.groupBy}
          onChange={(event) => apply({ ...draft, groupBy: event.target.value })}
        >
          <option value="">Group by: None</option>
          <option value="session">Group by: Session</option>
          <option value="prompt">Group by: Prompt</option>
          <option value="type">Group by: Type</option>
        </SelectField>
        <Button type="submit" size="sm">
          Filter / refresh
        </Button>
      </FilterBar>
      {error ? (
        <ErrorMessage error={error} title="Could not load the AI runs" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.available ? <AiUnavailable answer={data} /> : null}
      {data?.available && !data.runs.length ? (
        <EmptyState
          title="No AI runs yet. Enable Panoptic observation and execute a flow; runs appear when collection completes."
          hint={filtered ? "No run matches these filters. Clear them to see all runs." : undefined}
        />
      ) : null}
      {data?.available && data.runs.length ? (
        <div className={cn("transition-opacity", loading && "opacity-60")}>
          <StatTiles
            label="AI runs summary"
            items={[
              { label: "Runs", value: formatNumber(data.stats.count) },
              {
                label: "Failed",
                value: formatNumber(data.stats.failed),
                tone: data.stats.failed ? "warning" : "success",
              },
              {
                label: "Estimated cost",
                value: formatUsd(data.stats.estimatedCostUsd),
                hint: data.stats.unpricedRuns
                  ? `Estimated from model pricing · ${formatNumber(data.stats.unpricedRuns)} unpriced ${data.stats.unpricedRuns === 1 ? "run" : "runs"} not in the cost`
                  : "Estimated from model pricing",
              },
              { label: "p50", value: formatLatency(data.stats.p50Ms) },
              { label: "p95", value: formatLatency(data.stats.p95Ms) },
            ]}
          />
          {data.groups ? (
            <div className="mb-4">
              <TableCard label="Run groups">
                <TableHeader>
                  <TableRow>
                    <TableHead className={HEAD}>{`Group by ${applied.groupBy}`}</TableHead>
                    <TableHead className={`${HEAD} ${NUM_CELL}`}>Runs</TableHead>
                    <TableHead className={`${HEAD} ${NUM_CELL}`}>Failed</TableHead>
                    <TableHead className={`${HEAD} ${NUM_CELL}`}>Estimated cost</TableHead>
                    <TableHead className={`${HEAD} ${NUM_CELL}`}>p95</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.groups.map((group) => (
                    <TableRow
                      key={group.key}
                      {...rowOpen(() =>
                        apply({ ...applied, groupBy: "", ...groupFilter(applied.groupBy, group) }),
                      )}
                      aria-label={`Show runs of ${group.label}`}
                    >
                      <TableCell className="max-w-72 truncate font-medium">{group.label}</TableCell>
                      <TableCell className={NUM_CELL}>{formatNumber(group.runs)}</TableCell>
                      <TableCell className={NUM_CELL}>{formatNumber(group.failed)}</TableCell>
                      <TableCell className={NUM_CELL}>
                        {formatUsd(group.estimatedCostUsd)}
                      </TableCell>
                      <TableCell className={NUM_CELL}>{formatLatency(group.p95Ms)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </TableCard>
            </div>
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
        </div>
      ) : null}
    </div>
  );
}
