import { useCallback, useMemo, useState } from "react";
import { useApi, useStream, type StreamEvent } from "@/api/hooks";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  ClearFilters,
  CodeBlock,
  DetailSection,
  FilterBar,
  PageHeader,
  Pill,
  ResultCount,
  SearchField,
  StatTiles,
} from "@/components/listing";
import { DASH, formatNumber, RowButton, Time, ToggleButton } from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";

type MailSummary = {
  id: string;
  requestId?: string;
  capturedAt: number;
  to: string[];
  subject: string;
};
type Mail = MailSummary & {
  from?: string;
  cc: string[];
  bcc: string[];
  text?: string;
  headers: Record<string, string>;
  attachments: { filename: string; contentType?: string; size?: number }[];
};

function MailDetail({ id }: { id: string }) {
  const {
    data: mail,
    error,
    loading,
    reload,
  } = useApi<Mail>(`api/mails/${encodeURIComponent(id)}`);
  const [html, setHtml] = useState(true);

  if (error && !mail)
    return <ErrorMessage error={error} title="Could not load this message" onRetry={reload} />;
  if (!mail) return loading ? <LoadingRows rows={4} /> : null;

  const fields: [string, string | undefined][] = [
    ["From", mail.from],
    ["To", mail.to?.join(", ")],
    ["Cc", mail.cc?.join(", ")],
    ["Bcc", mail.bcc?.join(", ")],
    ...Object.entries(mail.headers ?? {}),
  ];

  return (
    <section aria-label="Mail detail" className="space-y-3">
      <h2 className="text-base font-semibold break-words">{mail.subject || "(No subject)"}</h2>
      <DetailSection title="Headers">
        <table className="w-full text-sm">
          <tbody>
            {fields.map(([name, value]) => (
              <tr key={name} className="border-b last:border-0">
                <th className="w-24 py-1.5 pr-3 text-left align-top text-xs font-medium text-muted-foreground">
                  {name}
                </th>
                <td className="py-1.5 break-all">{value || DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {mail.requestId ? (
          <p className="text-sm">
            <a className="underline" href={`#requests/${encodeURIComponent(mail.requestId)}`}>
              Open the request that sent it
            </a>
          </p>
        ) : null}
      </DetailSection>
      <DetailSection
        title="Body"
        actions={
          <div className="flex gap-1">
            <ToggleButton active={html} onClick={() => setHtml(true)}>
              HTML
            </ToggleButton>
            <ToggleButton active={!html} onClick={() => setHtml(false)}>
              Text
            </ToggleButton>
          </div>
        }
      >
        {html ? (
          <iframe
            className="h-96 w-full rounded-lg border bg-white"
            sandbox=""
            src={`api/mails/${encodeURIComponent(mail.id)}/html`}
            title="HTML email body"
          />
        ) : (
          <CodeBlock>{mail.text || "No plain-text body."}</CodeBlock>
        )}
      </DetailSection>
      <DetailSection title="Attachments">
        {mail.attachments?.length ? (
          <ul className="list-disc pl-5 text-sm">
            {mail.attachments.map((file, index) => (
              <li key={`${file.filename}-${index}`}>
                {file.filename} · {file.contentType || "unknown type"} · {formatNumber(file.size)}{" "}
                bytes
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No attachments." />
        )}
      </DetailSection>
    </section>
  );
}

/** The Mail tab: captured messages, with the HTML body in a sandboxed frame. */
export function MailPanel({ route, navigate }: DevtoolsPanelProps) {
  const { data, error, loading, reload } = useApi<MailSummary[]>("api/mails", {
    refreshMs: 30_000,
  });
  const [live, setLive] = useState<MailSummary[]>([]);

  const onStream = useCallback((event: StreamEvent) => {
    if (event.type !== "mail") return;

    const mail = event.data as MailSummary;

    setLive((previous) => [mail, ...previous.filter((item) => item.id !== mail.id)].slice(0, 200));
  }, []);

  useStream(["mail"], onStream);

  const mails = useMemo(() => {
    if (!data) return [];

    const seen = new Set(live.map((mail) => mail.id));

    return [...live, ...data.filter((mail) => !seen.has(mail.id))];
  }, [data, live]);

  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const shown = term
    ? mails.filter((mail) => `${mail.subject} ${mail.to.join(" ")}`.toLowerCase().includes(term))
    : mails;
  const recipients = new Set(mails.flatMap((mail) => mail.to)).size;
  const fromRequests = mails.filter((mail) => mail.requestId).length;

  return (
    <div>
      <PageHeader
        title="Mail"
        description="Every email your app sent, caught here instead of delivered. Open one to check its headers and body."
      >
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCwIcon />
          Refresh
        </Button>
      </PageHeader>
      {mails.length ? (
        <StatTiles
          items={[
            { label: "Messages", value: formatNumber(mails.length) },
            { label: "Recipients", value: formatNumber(recipients), hint: "distinct addresses" },
            { label: "Sent by a request", value: formatNumber(fromRequests) },
            { label: "Latest", value: <Time at={mails[0]?.capturedAt} /> },
          ]}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0">
          {mails.length ? (
            <FilterBar
              label="Mail filters"
              trailing={
                <>
                  <ResultCount shown={shown.length} total={mails.length} noun="message" />
                  {term ? <ClearFilters onClick={() => setSearch("")} /> : null}
                </>
              }
            >
              <SearchField
                label="Search mail"
                placeholder="Search subject or recipient"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </FilterBar>
          ) : null}
          {error ? (
            <ErrorMessage error={error} title="Could not load the mailbox" onRetry={reload} />
          ) : null}
          {!data && loading ? <LoadingRows /> : null}
          {data && !mails.length ? (
            <EmptyState
              title="No mail captured. Send an email from your app; it appears here."
              hint="Messages arrive live; there is nothing to configure."
            />
          ) : null}
          {mails.length && !shown.length ? (
            <EmptyState
              title="No message matches this search."
              hint="Clear the search to see every message."
            />
          ) : null}
          <div className="space-y-1.5">
            {shown.map((mail) => (
              <RowButton
                key={mail.id}
                selected={mail.id === route}
                className="rounded-xl bg-card p-3"
                onClick={() => navigate(mail.id)}
              >
                <div className="font-medium break-words">{mail.subject || "(No subject)"}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{mail.to.join(", ")}</span>
                  {mail.requestId ? <Pill tone="info">from a request</Pill> : null}
                  <Time at={mail.capturedAt} className="ml-auto" />
                </div>
              </RowButton>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          {route ? (
            <MailDetail key={route} id={route} />
          ) : (
            <EmptyState
              title="Select a message to inspect it."
              hint="Its headers, HTML body and attachments open here."
            />
          )}
        </div>
      </div>
    </div>
  );
}
