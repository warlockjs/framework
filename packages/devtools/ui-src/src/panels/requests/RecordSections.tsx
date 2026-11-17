import { Code, Json, SectionTitle } from "@/components/ui/panel-kit";
import type { RequestRecord } from "./types";

/** The parts only the persisted request log keeps: the error, the redacted input and the response. */
export function RecordSections({ record }: { record: RequestRecord }) {
  const input = {
    headers: record.headers,
    params: record.params,
    query: record.query,
    body: record.body,
    session: record.session,
    ip: record.ip,
  };
  const where = record.error
    ? [record.error.phase, record.error.file, record.error.site].filter(Boolean).join(" · ")
    : "";

  return (
    <>
      {record.error ? (
        <>
          <SectionTitle>Error</SectionTitle>
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
            <div>
              {record.error.name}: {record.error.message}
            </div>
            {where ? <div className="text-xs text-muted-foreground">{where}</div> : null}
          </div>
          {record.error.stack ? <Code>{record.error.stack}</Code> : null}
        </>
      ) : null}
      <SectionTitle>Request (redacted)</SectionTitle>
      <Json value={input} />
      <SectionTitle>Response</SectionTitle>
      <Json value={{ status: record.status, ...record.response }} />
      {record.queries?.nPlusOne?.length ? (
        <>
          <SectionTitle>{`Queries (${record.queries.count})`}</SectionTitle>
          <Json value={record.queries} />
        </>
      ) : null}
    </>
  );
}
