import { useCallback, useMemo, useState } from "react";
import type { DevtoolsInstancesView, DevtoolsLogRow, DevtoolsLogsView } from "@contracts";
import { useApi, useStream, type StreamEvent } from "@/api/hooks";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  clockTime,
  instanceLabel,
  Json,
  levelTone,
  PanelHeader,
  queryString,
  SelectField,
  TextField,
} from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";

const LEVELS = ["", "debug", "info", "warn", "error", "success"] as const;
const MAX_ROWS = 300;

/** The Logs tab: level and module filters, newest first, live rows from the stream. */
export function LogsPanel({ instance, session }: DevtoolsPanelProps) {
  const production = session.mode === "production";
  const [level, setLevel] = useState("");
  const [module, setModule] = useState("");
  const [live, setLive] = useState<DevtoolsLogRow[]>([]);
  const path = `api/logs${queryString({ level, module, instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsLogsView>(path, { refreshMs: 10_000 });
  const { data: instances } = useApi<DevtoolsInstancesView>(production ? "api/instances" : null);

  const onStream = useCallback((event: StreamEvent) => {
    if (event.type !== "log") return;

    const entry = event.data as DevtoolsLogRow;

    setLive((previous) =>
      [{ ...entry, instance: entry.instance ?? null }, ...previous].slice(0, MAX_ROWS),
    );
  }, []);

  useStream(["log"], onStream);

  const rows = useMemo(() => {
    if (!data) return [];

    const newest = data[0]?.at ?? 0;
    const fresh = live.filter(
      (row) =>
        row.at > newest &&
        (!level || row.level === level) &&
        (!module || row.module.toLowerCase().includes(module.toLowerCase())),
    );

    return [...fresh, ...data].slice(0, MAX_ROWS);
  }, [data, live, level, module]);

  return (
    <div>
      <PanelHeader
        title="Logs"
        note={production ? "Warnings and errors, without their context." : undefined}
      >
        <SelectField
          aria-label="Level"
          value={level}
          onChange={(event) => setLevel(event.target.value)}
        >
          {LEVELS.map((name) => (
            <option key={name} value={name}>
              {name || "All levels"}
            </option>
          ))}
        </SelectField>
        <TextField
          placeholder="Filter module"
          aria-label="Filter module"
          value={module}
          onChange={(event) => setModule(event.target.value)}
        />
      </PanelHeader>
      {error ? (
        <ErrorMessage error={error} title="Could not load the logs" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !rows.length ? <EmptyState title="No logs found for these filters." /> : null}
      <div className="space-y-1">
        {rows.map((row, index) => (
          <div key={`${row.at}-${index}`} className="rounded-md border p-2 text-sm">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className={`font-semibold ${levelTone(row.level)}`}>{row.level}</span>
              <span>
                {row.module} · {row.action} · {clockTime(row.at)}
              </span>
              {production && row.instance ? (
                <span>{instanceLabel(row.instance, instances?.instances)}</span>
              ) : null}
              {row.requestId ? (
                <a className="underline" href={`#requests/${encodeURIComponent(row.requestId)}`}>
                  request
                </a>
              ) : null}
            </div>
            <div className="break-words">{row.message}</div>
            {row.context !== undefined ? (
              <details>
                <summary className="cursor-pointer text-xs">Context</summary>
                <Json value={row.context} />
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
