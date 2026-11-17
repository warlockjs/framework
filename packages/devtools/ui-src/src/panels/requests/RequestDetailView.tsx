import { useState } from "react";
import type { DevtoolsSessionView } from "@contracts";
import { apiFetch } from "@/api/client";
import { useApi } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  clockTime,
  Code,
  formatMs,
  formatNumber,
  Json,
  levelTone,
  SectionTitle,
  statusTone,
  DASH,
} from "@/components/ui/panel-kit";
import { ExplainBox, type ExplainOutcome } from "@/panels/queries/ExplainBox";
import { RecordSections } from "./RecordSections";
import { queryText, canExplainDevelopment } from "./query-text";
import type { DetailQuery, RequestDetail } from "./types";
import { Waterfall } from "./Waterfall";

type AiRunRow = { traceId: string; name: string; status: string; duration: number };
type AiAnswer = { available: boolean; message?: string; runs: AiRunRow[] };

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
}: {
  query: DetailQuery;
  requestId: string;
  nPlusOne: boolean;
  session: DevtoolsSessionView;
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
    <div className="rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{query.driver}</span>
        <span className="tabular-nums">{formatMs(query.durationMs)}</span>
        <span className="tabular-nums">{formatNumber(query.rowCount)} rows</span>
        {nPlusOne ? <Badge variant="destructive">N+1</Badge> : null}
        {query.error ? <span className="text-destructive">{query.error}</span> : null}
      </div>
      <Code className="mt-1">{queryText(query)}</Code>
      {query.bindings ? (
        <Code className="mt-1">{`bindings: ${JSON.stringify(query.bindings, null, 2)}`}</Code>
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
    return <EmptyState title={data?.message ?? "AI observation is not available."} />;
  if (!data.runs.length) return <EmptyState title="No AI runs collected for this request yet." />;

  return (
    <ul className="space-y-1">
      {data.runs.map((run) => (
        <li key={run.traceId}>
          <a
            className="block rounded-md border p-2 text-sm hover:bg-muted/60"
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
export function RequestDetailView({ id, session }: { id: string; session: DevtoolsSessionView }) {
  const {
    data: request,
    error,
    loading,
    reload,
  } = useApi<RequestDetail>(`api/requests/${encodeURIComponent(id)}`);
  const development = session.mode === "development";

  if (error && !request)
    return <ErrorMessage error={error} title="Could not load this request" onRetry={reload} />;
  if (!request) return loading ? <LoadingRows rows={5} /> : null;

  const nPlusOneShapes = new Set(request.warnings.map((warning) => warning.shape));
  const counts = Array.isArray(request.cache) ? null : request.cache;
  const operations = Array.isArray(request.cache) ? request.cache : null;
  const partial = request.partial === true;

  return (
    <section aria-label="Request detail" className="space-y-1">
      <h2 className="text-base font-semibold break-all">
        {request.method} {request.path} ·{" "}
        <span className={statusTone(request.status)}>{request.status ?? DASH}</span> ·{" "}
        {formatMs(request.durationMs)}
      </h2>
      {partial ? (
        <p className="text-xs text-muted-foreground">
          <Badge variant="outline">not sampled</Badge> Kept because it was slow or failed. Phases,
          queries and logs were not recorded for it.
        </p>
      ) : null}
      {request.error ? <p className="text-sm text-destructive">{request.error}</p> : null}

      {request.warnings.length ? (
        <>
          <SectionTitle>Warnings</SectionTitle>
          {request.warnings.map((warning, index) => (
            <p
              key={index}
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm"
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
        </>
      ) : null}

      <div className="pt-2">
        <CopyCurl id={request.id} />
      </div>

      {request.record ? <RecordSections record={request.record} /> : null}

      <SectionTitle>Waterfall</SectionTitle>
      <Waterfall request={request} />

      <SectionTitle>Queries</SectionTitle>
      {request.queries.length ? (
        <div className="space-y-2">
          {request.queries.map((query) => (
            <QueryRow
              key={query.id}
              query={query}
              requestId={request.id}
              nPlusOne={nPlusOneShapes.has(query.shape ?? query.sql ?? "")}
              session={session}
            />
          ))}
          {request.droppedQueries ? (
            <p className="text-xs text-muted-foreground">
              {request.droppedQueries} more queries ran but were not kept (the per-request limit was
              reached).
            </p>
          ) : null}
        </div>
      ) : (
        <EmptyState title="No queries recorded." />
      )}

      {counts ? (
        <>
          <SectionTitle>Cache</SectionTitle>
          <p className="text-sm tabular-nums">
            {counts.hits} hits · {counts.misses} misses · {counts.writes} writes
          </p>
        </>
      ) : operations?.length ? (
        <>
          <SectionTitle>Cache</SectionTitle>
          <ul className="text-xs font-mono">
            {operations.map((operation, index) => (
              <li key={index}>
                {operation.type} {operation.key || operation.keys?.join(", ") || ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <SectionTitle>Request logs</SectionTitle>
      {request.logs.length ? (
        <ul className="space-y-1">
          {request.logs.map((log, index) => (
            <li key={index} className="rounded-md border p-2 text-sm">
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span className={levelTone(log.level)}>{log.level}</span>
                <span>
                  {log.module} · {log.action} · {clockTime(log.at)}
                </span>
              </div>
              <div className="break-words">{log.message}</div>
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

      {development || request.mails?.length ? (
        <>
          <SectionTitle>Request mail</SectionTitle>
          {request.mails?.length ? (
            <ul className="space-y-1">
              {request.mails.map((mailId) => (
                <li key={mailId}>
                  <a
                    className="block rounded-md border p-2 text-sm hover:bg-muted/60"
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
        </>
      ) : null}

      {development ? (
        <>
          <SectionTitle>AI runs</SectionTitle>
          <AiSection requestId={request.id} />
        </>
      ) : null}
    </section>
  );
}
