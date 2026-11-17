import { useState } from "react";
import type { DevtoolsErrorsView, DevtoolsInstancesView } from "@contracts";
import { useApi } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import {
  Code,
  DASH,
  formatNumber,
  instanceLabel,
  PanelHeader,
  queryString,
  statusTone,
  Time,
} from "@/components/ui/panel-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DevtoolsPanelProps } from "@/panels/types";

/** The Errors tab: errors grouped by fingerprint, with the stack and a link to the last request. */
export function ErrorsPanel({ instance, session }: DevtoolsPanelProps) {
  const [open, setOpen] = useState<string | null>(null);
  const production = session.mode === "production";
  const path = `api/errors${queryString({ instance: instance === "all" ? undefined : instance })}`;
  const { data, error, loading, reload } = useApi<DevtoolsErrorsView>(path, { refreshMs: 10_000 });
  const { data: instances } = useApi<DevtoolsInstancesView>(production ? "api/instances" : null);

  return (
    <div>
      <PanelHeader title="Errors" note="Grouped by message, route and source." />
      {error ? (
        <ErrorMessage error={error} title="Could not load the errors" onRetry={reload} />
      ) : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.groups.length ? (
        <EmptyState title="No errors recorded. Failed requests and error logs appear here." />
      ) : null}
      {data?.groups.length ? (
        <Table aria-label="Error groups">
          <TableHeader>
            <TableRow>
              <TableHead>Message</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Route</TableHead>
              <TableHead className="text-right">Status</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead>First seen</TableHead>
              <TableHead>Last seen</TableHead>
              {production ? <TableHead>Instances</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.groups.map((group) => (
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
        </Table>
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
  group: DevtoolsErrorsView["groups"][number];
  open: boolean;
  onToggle: () => void;
  production: boolean;
  labels: string;
}) {
  return (
    <>
      <TableRow data-state={open ? "selected" : undefined}>
        <TableCell className="max-w-md whitespace-normal">
          <button
            type="button"
            className="text-left break-words"
            aria-expanded={open}
            onClick={onToggle}
          >
            {group.message}
          </button>
          {group.source === "log" ? (
            <Badge variant="outline" className="ml-2">
              log
            </Badge>
          ) : null}
        </TableCell>
        <TableCell className="font-mono text-xs">{group.name ?? DASH}</TableCell>
        <TableCell className="font-mono text-xs">{group.route ?? DASH}</TableCell>
        <TableCell className={`text-right tabular-nums ${statusTone(group.status)}`}>
          {group.status ?? DASH}
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatNumber(group.count)}</TableCell>
        <TableCell>
          <Time at={group.firstSeen} />
        </TableCell>
        <TableCell>
          <Time at={group.lastSeen} />
        </TableCell>
        {production ? (
          <TableCell className="text-xs whitespace-normal">{labels || DASH}</TableCell>
        ) : null}
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={production ? 8 : 7} className="whitespace-normal">
            {group.stack ? (
              <Code>{group.stack}</Code>
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
