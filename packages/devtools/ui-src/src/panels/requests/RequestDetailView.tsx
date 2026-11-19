import { useState } from "react";
import type { DevtoolsSessionView } from "@contracts";
import { apiFetch } from "@/api/client";
import { useApi } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  BackButton,
  CodeBlock,
  DetailSection,
  DurationBar,
  KeyValueGrid,
  LevelPill,
  MethodPill,
  Pill,
  StatusPill,
} from "@/components/listing";
import { clockTime, formatMs, formatNumber, Json, Time } from "@/components/ui/panel-kit";
import { ExplainBox, type ExplainOutcome } from "@/panels/queries/ExplainBox";
import { RecordSections } from "./RecordSections";
import { queryText, canExplainDevelopment } from "./query-text";
import type { DetailQuery, RequestDetail } from "./types";
import { Waterfall } from "./Waterfall";

type AiRunRow = { traceId: string; name: string; status: string; duration: number };
type AiAnswer = { available: boolean; title?: string; message?: string; runs: AiRunRow[] };

function CopyCurl({ id }: { id: string }) {
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            const { curl } = await apiFetch<{ curl: string }>(
              `api/requests/${encodeURIComponent(id)}/curl`,
            );

            await navigator.clipboard.writeText(curl);
            setStatus({ tone: "ok", text: "Copied. Redacted values stay redacted." });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            setStatus({
              tone: "error",
              text: `Could not copy the curl command: ${message} Try again, or copy it from the server's request log.`,
            });
          }
        }}
      >
        Copy as curl
      </Button>
      {status ? (
        <span
          role="status"
          className={
            status.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {status.text}
        </span>
      ) : null}
    </div>
  );
}

function QueryRow({
  query,
  requestId,
  nPlusOne,
  session,
  slowest,
}: {
  query: DetailQuery;
  requestId: string;
  nPlusOne: boolean;
  session: DevtoolsSessionView;
  slowest: number;
}) {
  const development = session.mode === "development";
  const isAdmin = session.role === "admin";
  const explainable = development
    ? canExplainDevelopment(query)
    : isAdmin && Boolean(query.shapeId);

  const run = async (): Promise<ExplainOutcome> => {
    if (development) {
      return apiFetch<ExplainOutcome>(
        `api/requests/${encodeURIComponent(requestId)}/queries/${encodeURIComponent(query.id)}/explain`,
        { method: "POST" },
      );
    }

    return apiFetch<ExplainOutcome>(
      `api/queries/${encodeURIComponent(query.shapeId ?? "")}/explain`,
      {
        method: "POST",
      },
    );
  };

  return (
    <div className="space-y-2 rounded-lg border p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Pill>{query.driver}</Pill>
        <span className="w-28">
          <DurationBar ms={query.durationMs} max={slowest} text={formatMs(query.durationMs)} />
        </span>
        <span className="tabular-nums">{formatNumber(query.rowCount)} rows</span>
        {nPlusOne ? <Pill tone="warning">N+1</Pill> : null}
        {query.error ? <span className="text-destructive">{query.error}</span> : null}
      </div>
      <CodeBlock>{queryText(query)}</CodeBlock>
      {query.bindings ? (
        <CodeBlock>{`bindings: ${JSON.stringify(query.bindings, null, 2)}`}</CodeBlock>
      ) : null}
      {explainable ? <ExplainBox run={run} /> : null}
    </div>
  );
}

function AiSection({ requestId }: { requestId: string }) {
  const { data, error, loading } = useApi<AiAnswer>(
    `api/ai?requestId=${encodeURIComponent(requestId)}`,
  );

  if (error) return <ErrorMessage error={error} title="Could not load the AI runs" />;
  if (!data && loading) return <LoadingRows rows={1} />;
  if (!data?.available)
    return (
      <EmptyState title={data?.title ?? data?.message ?? "AI observation is not available."} />
    );
  if (!data.runs.length) return <EmptyState title="No AI runs collected for this request yet." />;

  return (
    <ul className="space-y-1">
      {data.runs.map((run) => (
        <li key={run.traceId}>
          <a
            className="block rounded-lg border p-2.5 text-sm hover:bg-muted/60"
            href={`#ai/${encodeURIComponent(run.traceId)}`}
          >
            {run.name} · {run.status} · {formatMs(run.duration)}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** One request: warnings, curl, the persisted record, waterfall, queries, logs, mail and AI runs. */
export function RequestDetailView({
  id,
  session,
  onClose,
}: {
  id: string;
  session: DevtoolsSessionView;
  onClose?: () => void;
}) {
  const {
    data: request,
    error,
    loading,
    reload,
  } = useApi<RequestDetail>(`api/requests/${encodeURIComponent(id)}`);
  const development = session.mode === "development";

  if (error && !request)
    return (
      <div>
        {onClose ? <BackButton onClick={onClose} /> : null}
        <ErrorMessage error={error} title="Could not load this request" onRetry={reload} />
      </div>
    );
  if (!request) return loading ? <LoadingRows rows={5} /> : null;

  const nPlusOneShapes = new Set(request.warnings.map((warning) => warning.shape));
  const counts = Array.isArray(request.cache) ? null : request.cache;
  const operations = Array.isArray(request.cache) ? request.cache : null;
  const partial = request.partial === true;
  const slowestQuery = Math.max(0, ...request.queries.map((query) => query.durationMs));

  return (
    <section aria-label="Request detail" className="space-y-3">
      <div>
        {onClose ? <BackButton onClick={onClose}>Close request</BackButton> : null}
        <div className="flex flex-wrap items-center gap-2">
          <MethodPill method={request.method} />
          <StatusPill status={request.status} />
          <h2 className="min-w-0 font-mono text-base font-semibold break-all">{request.path}</h2>
        </div>
      </div>
      <KeyValueGrid
        items={[
          { label: "Duration", value: formatMs(request.durationMs) },
          { label: "Started", value: <Time at={request.startedAt} /> },
          { label: "Route", value: request.route ?? "—" },
          { label: "Queries", value: formatNumber(request.queryCount) },
          { label: "Warnings", value: formatNumber(request.warningCount) },
          { label: "Id", value: <span className="font-mono text-xs">{request.id}</span> },
        ]}
      />
      {partial ? (
        <p className="text-xs text-muted-foreground">
          <Pill>not sampled</Pill> Kept because it was slow or failed. Phases, queries and logs were
          not recorded for it.
        </p>
      ) : null}
      {request.error ? <p className="text-sm text-destructive">{request.error}</p> : null}

      {request.warnings.length ? (
        <DetailSection title="Warnings">
          {request.warnings.map((warning, index) => (
            <p
              key={index}
              className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm"
            >
              {warning.message}{" "}
              {warning.caller ? (
                <a
                  className="underline"
                  href={`vscode://file/${warning.caller.file}:${warning.caller.line}:${warning.caller.column}`}
                >
                  {warning.caller.file}:{warning.caller.line}
                </a>
              ) : null}
            </p>
          ))}
        </DetailSection>
      ) : null}

      <CopyCurl id={request.id} />

      {request.record ? <RecordSections record={request.record} /> : null}

      <DetailSection title="Waterfall">
        <Waterfall request={request} />
      </DetailSection>

      <DetailSection title={`Queries (${request.queries.length})`}>
        {request.queries.length ? (
          <div className="space-y-2">
            {request.queries.map((query) => (
              <QueryRow
                key={query.id}
                query={query}
                requestId={request.id}
                nPlusOne={nPlusOneShapes.has(query.shape ?? query.sql ?? "")}
                session={session}
                slowest={slowestQuery}
              />
            ))}
            {request.droppedQueries ? (
              <p className="text-xs text-muted-foreground">
                {request.droppedQueries} more queries ran but were not kept (the per-request limit
                was reached).
              </p>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No queries recorded." />
        )}
      </DetailSection>

      {counts ? (
        <DetailSection title="Cache">
          <p className="text-sm tabular-nums">
            {counts.hits} hits · {counts.misses} misses · {counts.writes} writes
          </p>
        </DetailSection>
      ) : operations?.length ? (
        <DetailSection title="Cache">
          <ul className="font-mono text-xs">
            {operations.map((operation, index) => (
              <li key={index}>
                {operation.type} {operation.key || operation.keys?.join(", ") || ""}
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      <DetailSection title="Request logs">
        {request.logs.length ? (
          <ul className="space-y-2">
            {request.logs.map((log, index) => (
              <li key={index} className="rounded-lg border p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <LevelPill level={log.level} />
                  <span>
                    {log.module} · {log.action} · {clockTime(log.at)}
                  </span>
                </div>
                <div className="mt-1 break-words">{log.message}</div>
                {log.context !== undefined ? (
                  <details>
                    <summary className="cursor-pointer text-xs">Context</summary>
                    <Json value={log.context} />
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No logs recorded." />
        )}
      </DetailSection>

      {development || request.mails?.length ? (
        <DetailSection title="Request mail">
          {request.mails?.length ? (
            <ul className="space-y-1">
              {request.mails.map((mailId) => (
                <li key={mailId}>
                  <a
                    className="block rounded-lg border p-2.5 text-sm hover:bg-muted/60"
                    href={`#mail/${encodeURIComponent(mailId)}`}
                  >
                    Mail {mailId}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No mail captured." />
          )}
        </DetailSection>
      ) : null}

      {development ? (
        <DetailSection title="AI runs">
          <AiSection requestId={request.id} />
        </DetailSection>
      ) : null}
    </section>
  );
}
