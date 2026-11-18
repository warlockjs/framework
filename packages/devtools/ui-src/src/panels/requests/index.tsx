import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { DevtoolsInstancesView } from "@contracts";
import { apiFetch } from "@/api/client";
import { useApi, useStream, type StreamEvent } from "@/api/hooks";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  ClearFilters,
  DurationBar,
  FilterBar,
  HEAD,
  PageHeader,
  percentile,
  Pill,
  ResultCount,
  rowOpen,
  Segmented,
  StatTiles,
  StatusPill,
  MethodPill,
  TableCard,
} from "@/components/listing";
import {
  formatMs,
  formatPercent,
  instanceLabel,
  queryString,
  SelectField,
  TextField,
  Time,
} from "@/components/ui/panel-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DevtoolsPanelProps } from "@/panels/types";
import { RequestDetailView } from "./RequestDetailView";
import type { RequestRow } from "./types";

type Filters = { q: string; status: string; method: string; route: string; since: string };

const NO_FILTERS: Filters = { q: "", status: "", method: "", route: "", since: "" };
const STATUS_CLASSES = [
  { value: "", label: "All" },
  { value: "2xx", label: "2xx" },
  { value: "3xx", label: "3xx" },
  { value: "4xx", label: "4xx" },
  { value: "5xx", label: "5xx" },
];
const SINCE = [
  { value: "", label: "Any time" },
  { value: "15m", label: "Last 15 min" },
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
];

function Row({
  row,
  selected,
  onOpen,
  label,
  slowest,
}: {
  row: RequestRow;
  selected: boolean;
  onOpen: () => void;
  label: string | null;
  slowest: number;
}) {
  const open = rowOpen(onOpen);

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      aria-current={selected || undefined}
      {...open}
    >
      <TableCell className="w-16">
        <StatusPill status={row.status} />
      </TableCell>
      <TableCell className="max-w-0 min-w-56 whitespace-normal">
        <div className="flex items-center gap-2">
          <MethodPill method={row.method} />
          <div className="truncate font-mono text-xs" title={row.path}>
            {row.path}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {row.persisted ? <Pill tone="brand">saved</Pill> : null}
          {row.partial ? <Pill>not sampled</Pill> : null}
          {row.partial ? null : <span className="tabular-nums">{row.queryCount} queries</span>}
          {row.warningCount ? <Pill tone="warning">{`⚠ ${row.warningCount}`}</Pill> : null}
          {label ? <span>{label}</span> : null}
        </div>
      </TableCell>
      <TableCell className="w-28">
        <DurationBar
          ms={row.durationMs}
          max={slowest}
          text={formatMs(row.durationMs)}
          tone={row.status && row.status >= 500 ? "bg-destructive" : "bg-brand"}
        />
      </TableCell>
      <TableCell className="w-24 text-right text-xs whitespace-nowrap text-muted-foreground">
        <Time at={row.startedAt} />
      </TableCell>
    </TableRow>
  );
}

/** The Requests tab: filterable live list, and one request's detail beside it. */
export function RequestsPanel({ route, navigate, session }: DevtoolsPanelProps) {
  const production = session.mode === "production";
  const isAdmin = session.role === "admin";
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [live, setLive] = useState<RequestRow[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [clearError, setClearError] = useState<unknown>(null);
  const filtered = Object.values(filters).some((value) => value.trim());
  const path = `api/requests${queryString(filters)}`;
  const { data, error, loading, reload } = useApi<RequestRow[]>(path, { refreshMs: 10_000 });
  const { data: instances } = useApi<DevtoolsInstancesView>(production ? "api/instances" : null);
  const filteredRef = useRef(filtered);

  useEffect(() => {
    filteredRef.current = filtered;
  }, [filtered]);

  const onStream = useCallback((event: StreamEvent) => {
    if (event.type !== "request" || filteredRef.current) return;

    const row = event.data as RequestRow;

    setLive((previous) => [row, ...previous.filter((item) => item.id !== row.id)].slice(0, 200));
  }, []);

  useStream(["request"], onStream);

  const rows = useMemo(() => {
    if (!data) return [];
    if (filtered) return data;

    const seen = new Set(live.map((row) => row.id));

    return [...live, ...data.filter((row) => !seen.has(row.id))].slice(0, 200);
  }, [data, live, filtered]);

  const clear = async () => {
    try {
      await apiFetch<void>("api/requests", { method: "DELETE" });
      setLive([]);
      setConfirming(false);
      setClearError(null);
      navigate("");
      reload();
    } catch (failure) {
      setClearError(failure);
    }
  };

  const durations = rows.flatMap((row) => (row.durationMs == null ? [] : [row.durationMs]));
  const slowest = durations.length ? Math.max(...durations) : 0;
  const withStatus = rows.filter((row) => row.status != null);
  const failed = withStatus.filter((row) => (row.status ?? 0) >= 500).length;
  const p95 = percentile(durations, 95);
  const resetFilters = () => {
    setDraft(NO_FILTERS);
    setFilters(NO_FILTERS);
  };
  const pickStatus = (value: string) => {
    const next = { ...draft, status: value };

    setDraft(next);
    setFilters(next);
  };

  const update =
    (key: keyof Filters) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((previous) => ({ ...previous, [key]: event.target.value }));

  return (
    <div>
      <PageHeader
        title="Requests"
        description={
          production
            ? "Sampled requests, plus slow and failed ones kept without a timeline."
            : "Every request your app served, newest first. Open one to see its timeline, queries and logs."
        }
      >
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCwIcon />
          Refresh
        </Button>
        {isAdmin ? (
          confirming ? (
            <>
              <Button size="sm" variant="destructive" onClick={clear}>
                Confirm clear
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
              Clear
            </Button>
          )
        ) : null}
      </PageHeader>
      {clearError ? (
        <ErrorMessage error={clearError} title="Could not clear the requests" className="mb-3" />
      ) : null}
      {rows.length ? (
        <StatTiles
          items={[
            {
              label: "Requests",
              value: rows.length,
              hint: filtered ? "matching the filters" : "in the list",
            },
            {
              label: "Server errors",
              value: withStatus.length ? formatPercent((failed / withStatus.length) * 100) : "—",
              hint: `${failed} with a 5xx status`,
              tone: failed ? "destructive" : "success",
            },
            { label: "p95 duration", value: formatMs(p95), hint: "95 % finished faster" },
            { label: "Slowest", value: formatMs(slowest || null), hint: "longest in the list" },
          ]}
        />
      ) : null}
      <FilterBar
        label="Request filters"
        onSubmit={() => setFilters(draft)}
        trailing={
          <>
            <ResultCount shown={rows.length} noun="request" />
            {filtered ? <ClearFilters onClick={resetFilters} /> : null}
          </>
        }
      >
        <TextField
          type="search"
          placeholder="Search url or id"
          aria-label="Search url or id"
          className="min-w-44 flex-1"
          value={draft.q}
          onChange={update("q")}
        />
        <Segmented
          label="Status class"
          options={STATUS_CLASSES}
          value={STATUS_CLASSES.some((item) => item.value === draft.status) ? draft.status : "x"}
          onChange={pickStatus}
        />
        <TextField
          placeholder="Status: 404 or 5xx"
          aria-label="Status"
          className="w-36"
          value={draft.status}
          onChange={update("status")}
        />
        <TextField
          placeholder="Method"
          aria-label="Method"
          className="w-24"
          value={draft.method}
          onChange={update("method")}
        />
        <TextField
          placeholder="Route"
          aria-label="Route"
          className="w-32"
          value={draft.route}
          onChange={update("route")}
        />
        <SelectField aria-label="Since" value={draft.since} onChange={update("since")}>
          {SINCE.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </SelectField>
        <Button type="submit" size="sm">
          Filter
        </Button>
      </FilterBar>
      <div className={route ? "grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : undefined}>
        <div className="min-w-0">
          {error ? (
            <ErrorMessage error={error} title="Could not load the requests" onRetry={reload} />
          ) : null}
          {!data && loading ? <LoadingRows /> : null}
          {data && !rows.length ? (
            <EmptyState
              title={
                filtered
                  ? "No request matches these filters. Loosen or reset them."
                  : "No requests yet. Make a request to your app."
              }
              hint={
                filtered
                  ? "Use Clear filters to see every request again."
                  : "New requests appear here as they arrive."
              }
            />
          ) : null}
          {rows.length ? (
            <TableCard label="Requests">
              <TableHeader>
                <TableRow>
                  <TableHead className={HEAD}>Status</TableHead>
                  <TableHead className={HEAD}>Request</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Duration</TableHead>
                  <TableHead className={`${HEAD} text-right`}>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    selected={row.id === route}
                    onOpen={() => navigate(row.id)}
                    slowest={slowest}
                    label={production ? instanceLabel(row.instance, instances?.instances) : null}
                  />
                ))}
              </TableBody>
            </TableCard>
          ) : null}
        </div>
        {route ? (
          <div className="min-w-0">
            <RequestDetailView
              key={route}
              id={route}
              session={session}
              onClose={() => navigate("")}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
