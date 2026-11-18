import { useCallback, useMemo, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { DevtoolsInstancesView, DevtoolsLogRow, DevtoolsLogsView } from "@contracts";
import { useApi, useStream, type StreamEvent } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  ClearFilters,
  FilterBar,
  HEAD,
  LevelPill,
  PageHeader,
  ResultCount,
  SearchField,
  Segmented,
  StatTiles,
  TableCard,
} from "@/components/listing";
import {
  clockTime,
  formatNumber,
  instanceLabel,
  Json,
  queryString,
} from "@/components/ui/panel-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DevtoolsPanelProps } from "@/panels/types";

const LEVELS = ["", "debug", "info", "warn", "error", "success"] as const;
const MAX_ROWS = 300;

/** The Logs tab: level and module filters, newest first, live rows from the stream. */
export function LogsPanel({ instance, session }: DevtoolsPanelProps) {
  const production = session.mode === "production";
  const [level, setLevel] = useState("");
  const [module, setModule] = useState("");
  const [search, setSearch] = useState("");
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

  const loaded = useMemo(() => {
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

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();

    return term
      ? loaded.filter((row) => `${row.message} ${row.action}`.toLowerCase().includes(term))
      : loaded;
  }, [loaded, search]);

  const filtered = Boolean(level) || Boolean(module) || Boolean(search.trim());
  const count = (name: string) => loaded.filter((row) => row.level === name).length;
  const clearFilters = () => {
    setLevel("");
    setModule("");
    setSearch("");
  };

  return (
    <div>
      <PageHeader
        title="Logs"
        description={
          production
            ? "Warnings and errors, without their context. Newest first."
            : "What your app logged, newest first, with live entries as they arrive."
        }
      >
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCwIcon />
          Refresh
        </Button>
      </PageHeader>
      {loaded.length ? (
        <StatTiles
          items={[
            { label: "Entries", value: formatNumber(loaded.length), hint: "loaded" },
            {
              label: "Errors",
              value: formatNumber(count("error")),
              tone: count("error") ? "destructive" : "success",
            },
            {
              label: "Warnings",
              value: formatNumber(count("warn")),
              tone: count("warn") ? "warning" : "success",
            },
            {
              label: "Modules",
              value: formatNumber(new Set(loaded.map((row) => row.module)).size),
            },
          ]}
        />
      ) : null}
      <FilterBar
        label="Log filters"
        trailing={
          <>
            <ResultCount shown={rows.length} total={loaded.length} noun="entry" />
            {filtered ? <ClearFilters onClick={clearFilters} /> : null}
          </>
        }
      >
        <SearchField
          label="Search messages"
          placeholder="Search messages"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SearchField
          label="Filter module"
          placeholder="Filter module"
          className="max-w-56 min-w-36 flex-none"
          value={module}
          onChange={(event) => setModule(event.target.value)}
        />
        <Segmented
          label="Level"
          value={level}
          onChange={setLevel}
          options={LEVELS.map((name) => ({ value: name, label: name || "All" }))}
        />
      </FilterBar>
      {error ? (
        <ErrorMessage error={error} title="Could not load the logs" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !rows.length ? (
        <EmptyState
          title="No logs found for these filters."
          hint={
            filtered
              ? "Clear the filters, or pick a lower level to see more."
              : "Entries appear here as your app logs them."
          }
        />
      ) : null}
      {rows.length ? (
        <TableCard label="Logs">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Time</TableHead>
              <TableHead className={HEAD}>Level</TableHead>
              <TableHead className={HEAD}>Source</TableHead>
              <TableHead className={HEAD}>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row.at}-${index}`} className="align-top">
                <TableCell
                  className="w-24 text-xs text-muted-foreground tabular-nums"
                  title={new Date(row.at).toLocaleString()}
                >
                  {clockTime(row.at)}
                </TableCell>
                <TableCell className="w-20">
                  <LevelPill level={row.level} />
                </TableCell>
                <TableCell className="max-w-48 text-xs">
                  <div className="truncate font-medium" title={`${row.module} · ${row.action}`}>
                    {row.module} · {row.action}
                  </div>
                  <div className="flex gap-2 text-muted-foreground">
                    {production && row.instance ? (
                      <span>{instanceLabel(row.instance, instances?.instances)}</span>
                    ) : null}
                    {row.requestId ? (
                      <a
                        className="underline"
                        href={`#requests/${encodeURIComponent(row.requestId)}`}
                      >
                        request
                      </a>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="min-w-64 text-sm whitespace-normal">
                  <div className="break-words">{row.message}</div>
                  {row.context !== undefined ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Context
                      </summary>
                      <Json value={row.context} />
                    </details>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      ) : null}
    </div>
  );
}
