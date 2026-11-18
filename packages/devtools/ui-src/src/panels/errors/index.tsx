import { useMemo, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { DevtoolsErrorsView, DevtoolsInstancesView } from "@contracts";
import { useApi } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  ClearFilters,
  CodeBlock,
  FilterBar,
  HEAD,
  NUM_CELL,
  PageHeader,
  Pill,
  ResultCount,
  rowOpen,
  SearchField,
  Segmented,
  StatTiles,
  StatusPill,
  TableCard,
} from "@/components/listing";
import { DASH, formatNumber, instanceLabel, queryString, Time } from "@/components/ui/panel-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DevtoolsPanelProps } from "@/panels/types";

type Group = DevtoolsErrorsView["groups"][number];

const SOURCES = [
  { value: "", label: "All" },
  { value: "request", label: "Requests" },
  { value: "log", label: "Logs" },
];

/** The Errors tab: errors grouped by fingerprint, with the stack and a link to the last request. */
export function ErrorsPanel({ instance, session }: DevtoolsPanelProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const production = session.mode === "production";
  const path = `api/errors${queryString({ instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsErrorsView>(path, { refreshMs: 10_000 });
  const { data: instances } = useApi<DevtoolsInstancesView>(production ? "api/instances" : null);
  const all = useMemo(() => data?.groups ?? [], [data]);
  const filtered = Boolean(search.trim()) || Boolean(source);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();

    return all.filter(
      (group) =>
        (!source || group.source === source) &&
        (!term ||
          `${group.message} ${group.name ?? ""} ${group.route ?? ""}`.toLowerCase().includes(term)),
    );
  }, [all, search, source]);

  const clearFilters = () => {
    setSearch("");
    setSource("");
  };

  return (
    <div>
      <PageHeader
        title="Errors"
        description="Failed requests and error logs, grouped by message, route and source."
      >
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCwIcon />
          Refresh
        </Button>
      </PageHeader>
      {error ? (
        <ErrorMessage error={error} title="Could not load the errors" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.groups.length ? (
        <EmptyState
          title="No errors recorded. Failed requests and error logs appear here."
          hint="Nothing has failed since the app started."
        />
      ) : null}
      {all.length ? (
        <>
          <StatTiles
            items={[
              { label: "Error groups", value: formatNumber(all.length), tone: "destructive" },
              {
                label: "Occurrences",
                value: formatNumber(all.reduce((sum, group) => sum + group.count, 0)),
              },
              {
                label: "From requests",
                value: formatNumber(all.filter((group) => group.source === "request").length),
                hint: "groups",
              },
              {
                label: "From logs",
                value: formatNumber(all.filter((group) => group.source === "log").length),
                hint: "groups",
              },
            ]}
          />
          <FilterBar
            label="Error filters"
            trailing={
              <>
                <ResultCount shown={groups.length} total={all.length} noun="group" />
                {filtered ? <ClearFilters onClick={clearFilters} /> : null}
              </>
            }
          >
            <SearchField
              label="Search errors"
              placeholder="Search message, name or route"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Segmented label="Source" options={SOURCES} value={source} onChange={setSource} />
          </FilterBar>
        </>
      ) : null}
      {all.length && !groups.length ? (
        <EmptyState
          title="No error group matches these filters."
          hint="Clear the filters to see every group."
        />
      ) : null}
      {groups.length ? (
        <TableCard label="Error groups">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Message</TableHead>
              <TableHead className={HEAD}>Route</TableHead>
              <TableHead className={`${HEAD} text-right`}>Status</TableHead>
              <TableHead className={`${HEAD} ${NUM_CELL}`}>Count</TableHead>
              <TableHead className={HEAD}>First seen</TableHead>
              <TableHead className={HEAD}>Last seen</TableHead>
              {production ? <TableHead className={HEAD}>Instances</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <GroupRows
                key={group.id}
                group={group}
                open={open === group.id}
                onToggle={() => setOpen(open === group.id ? null : group.id)}
                production={production}
                labels={group.instances
                  .map((id) => instanceLabel(id, instances?.instances))
                  .join(", ")}
              />
            ))}
          </TableBody>
        </TableCard>
      ) : null}
    </div>
  );
}

function GroupRows({
  group,
  open,
  onToggle,
  production,
  labels,
}: {
  group: Group;
  open: boolean;
  onToggle: () => void;
  production: boolean;
  labels: string;
}) {
  const toggle = rowOpen(onToggle);

  return (
    <>
      <TableRow data-state={open ? "selected" : undefined} {...toggle}>
        <TableCell className="max-w-md min-w-64 whitespace-normal">
          <button
            type="button"
            className="text-left font-medium break-words focus-visible:outline-none"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {group.message}
          </button>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {group.name ? <span className="font-mono">{group.name}</span> : null}
            {group.source === "log" ? <Pill>log</Pill> : null}
          </div>
        </TableCell>
        <TableCell className="max-w-48 font-mono text-xs">
          <div className="truncate" title={group.route ?? undefined}>
            {group.route ?? DASH}
          </div>
        </TableCell>
        <TableCell className="text-right">
          {group.status != null ? <StatusPill status={group.status} /> : DASH}
        </TableCell>
        <TableCell className={`${NUM_CELL} font-semibold`}>{formatNumber(group.count)}</TableCell>
        <TableCell className="text-xs text-muted-foreground">
          <Time at={group.firstSeen} />
        </TableCell>
        <TableCell className="text-xs">
          <Time at={group.lastSeen} />
        </TableCell>
        {production ? (
          <TableCell className="text-xs whitespace-normal">{labels || DASH}</TableCell>
        ) : null}
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={production ? 7 : 6} className="bg-muted/20 whitespace-normal">
            {group.stack ? (
              <CodeBlock>{group.stack}</CodeBlock>
            ) : (
              <p className="text-sm text-muted-foreground">
                No stack was available for this error.
              </p>
            )}
            {group.lastRequestId ? (
              <p className="mt-2 text-sm">
                <a
                  className="underline"
                  href={`#requests/${encodeURIComponent(group.lastRequestId)}`}
                >
                  Open the last request
                </a>
              </p>
            ) : null}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
