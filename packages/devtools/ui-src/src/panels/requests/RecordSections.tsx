import { CodeBlock, DetailSection } from "@/components/listing";
import type { RequestRecord } from "./types";

const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? "undefined";

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
        <DetailSection title="Error">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm">
            <div>
              {record.error.name}: {record.error.message}
            </div>
            {where ? <div className="text-xs text-muted-foreground">{where}</div> : null}
          </div>
          {record.error.stack ? <CodeBlock>{record.error.stack}</CodeBlock> : null}
        </DetailSection>
      ) : null}
      <DetailSection title="Request (redacted)">
        <CodeBlock>{pretty(input)}</CodeBlock>
      </DetailSection>
      <DetailSection title="Response">
        <CodeBlock>{pretty({ status: record.status, ...record.response })}</CodeBlock>
      </DetailSection>
      {record.queries?.nPlusOne?.length ? (
        <DetailSection title={`Queries (${record.queries.count})`}>
          <CodeBlock>{pretty(record.queries)}</CodeBlock>
        </DetailSection>
      ) : null}
    </>
  );
}
