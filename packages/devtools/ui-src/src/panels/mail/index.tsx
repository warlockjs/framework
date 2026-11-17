import { useCallback, useMemo, useState } from "react";
import { useApi, useStream, type StreamEvent } from "@/api/hooks";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  Code,
  DASH,
  formatNumber,
  PanelHeader,
  RowButton,
  SectionTitle,
  Time,
  ToggleButton,
} from "@/components/ui/panel-kit";
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
    <section aria-label="Mail detail">
      <h2 className="text-base font-semibold break-words">{mail.subject || "(No subject)"}</h2>
      <table className="mt-2 text-sm">
        <tbody>
          {fields.map(([name, value]) => (
            <tr key={name}>
              <th className="pr-3 text-left align-top font-medium">{name}</th>
              <td className="break-all">{value || DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {mail.requestId ? (
        <p className="mt-2 text-sm">
          <a className="underline" href={`#requests/${encodeURIComponent(mail.requestId)}`}>
            Open the request that sent it
          </a>
        </p>
      ) : null}
      <SectionTitle>Body</SectionTitle>
      <div className="mb-2 flex gap-2">
        <ToggleButton active={html} onClick={() => setHtml(true)}>
          HTML
        </ToggleButton>
        <ToggleButton active={!html} onClick={() => setHtml(false)}>
          Text
        </ToggleButton>
      </div>
      {html ? (
        <iframe
          className="h-96 w-full rounded-md border bg-white"
          sandbox=""
          src={`api/mails/${encodeURIComponent(mail.id)}/html`}
          title="HTML email body"
        />
      ) : (
        <Code>{mail.text || "No plain-text body."}</Code>
      )}
      <SectionTitle>Attachments</SectionTitle>
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

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div>
        <PanelHeader title="Mail" />
        {error ? (
          <ErrorMessage error={error} title="Could not load the mailbox" onRetry={reload} />
        ) : null}
        {!data && loading ? <LoadingRows /> : null}
        {data && !mails.length ? (
          <EmptyState title="No mail captured. Send an email from your app; it appears here." />
        ) : null}
        <div className="space-y-1">
          {mails.map((mail) => (
            <RowButton key={mail.id} selected={mail.id === route} onClick={() => navigate(mail.id)}>
              <div className="font-medium break-words">{mail.subject || "(No subject)"}</div>
              <div className="text-xs text-muted-foreground">
                {mail.to.join(", ")} · <Time at={mail.capturedAt} />
              </div>
            </RowButton>
          ))}
        </div>
      </div>
      <div>
        {route ? (
          <MailDetail key={route} id={route} />
        ) : (
          <EmptyState title="Select a message to inspect it." />
        )}
      </div>
    </div>
  );
}
