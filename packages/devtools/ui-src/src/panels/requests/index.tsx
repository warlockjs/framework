import { useCallback, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { DevtoolsInstancesView } from "@contracts";
import { apiFetch } from "@/api/client";
import { useApi, useStream, type StreamEvent } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DASH,
  EmptyState,
  ErrorMessage,
  formatMs,
  instanceLabel,
  LoadingRows,
  PanelHeader,
  queryString,
  RowButton,
  SelectField,
  statusTone,
  TextField,
  Time,
} from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";
import { RequestDetailView } from "./RequestDetailView";
import type { RequestRow } from "./types";

type Filters = { q: string; status: string; method: string; route: string; since: string };

const NO_FILTERS: Filters = { q: "", status: "", method: "", route: "", since: "" };
const SINCE = [
  { value: "", label: "Any time" },
  { value: "15m", label: "Last 15 min" },
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
];

function Row({ row, selected, onOpen, label }: { row: RequestRow; selected: boolean; onOpen: () => void; label: string | null }) {
  return (
    <RowButton selected={selected} onClick={onOpen}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{row.method}</span>
        <span className={`tabular-nums ${statusTone(row.status)}`}>{row.status ?? DASH}</span>
      </div>
      <div className="font-mono text-xs break-all">{row.path}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {row.persisted ? <Badge variant="secondary">saved</Badge> : null}
        {row.partial ? <Badge variant="outline">not sampled</Badge> : null}
        <span className="tabular-nums">{formatMs(row.durationMs)}</span>
        {row.partial ? null : <span className="tabular-nums">{row.queryCount} queries</span>}
        {row.warningCount ? <Badge variant="destructive">{`⚠ ${row.warningCount}`}</Badge> : null}
        {label ? <span>{label}</span> : null}
        <Time at={row.startedAt} />
      </div>
    </RowButton>
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

  filteredRef.current = filtered;

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

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draft);
  };

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

  const update = (key: keyof Filters) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((previous) => ({ ...previous, [key]: event.target.value }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div>
        <PanelHeader
          title="Requests"
          note={production ? "Sampled requests, plus slow and failed ones kept without a timeline." : undefined}
        >
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
        </PanelHeader>
        {clearError ? <ErrorMessage error={clearError} title="Could not clear the requests" /> : null}
        <form onSubmit={apply} className="mb-3 flex flex-wrap gap-2" aria-label="Request filters">
          <TextField type="search" placeholder="Search url or id" aria-label="Search url or id" value={draft.q} onChange={update("q")} />
          <TextField placeholder="Status: 404 or 5xx" aria-label="Status" className="w-36" value={draft.status} onChange={update("status")} />
          <TextField placeholder="Method" aria-label="Method" className="w-24" value={draft.method} onChange={update("method")} />
          <TextField placeholder="Route" aria-label="Route" className="w-32" value={draft.route} onChange={update("route")} />
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
          {filtered ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(NO_FILTERS);
                setFilters(NO_FILTERS);
              }}
            >
              Reset
            </Button>
          ) : null}
        </form>
        {error ? <ErrorMessage error={error} title="Could not load the requests" onRetry={reload} /> : null}
        {!data && loading ? <LoadingRows /> : null}
        {data && !rows.length ? (
          <EmptyState>
            {filtered ? "No request matches these filters. Loosen or reset them." : "No requests yet. Make a request to your app."}
          </EmptyState>
        ) : null}
        <div className="space-y-1">
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              selected={row.id === route}
              onOpen={() => navigate(row.id)}
              label={production ? instanceLabel(row.instance, instances?.instances) : null}
            />
          ))}
        </div>
      </div>
      <div>
        {route ? <RequestDetailView key={route} id={route} session={session} /> : <EmptyState>Select a request to inspect it.</EmptyState>}
      </div>
    </div>
  );
}
