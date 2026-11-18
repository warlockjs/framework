import { useCallback, useEffect, useState } from "react";
import type { DevtoolsAuditEntry, DevtoolsAuditType, DevtoolsUserListView } from "@contracts";
import { apiFetch } from "@/api/client";
import { useApi } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { LoadingRows } from "@/components/common/LoadingRows";

const PAGE_SIZE = 50;

const AUDIT_TYPES: readonly DevtoolsAuditType[] = [
  "admin.seeded",
  "admin.reset",
  "setup.completed",
  "login.succeeded",
  "login.failed",
  "login.blocked",
  "mfa.succeeded",
  "mfa.failed",
  "mfa.enrolled",
  "mfa.removed",
  "recovery-code.used",
  "recovery-codes.regenerated",
  "passkey.added",
  "passkey.removed",
  "password.changed",
  "logout",
  "session.revoked",
  "invite.created",
  "invite.revoked",
  "invite.accepted",
  "account.role-changed",
  "account.removed",
  "account.mfa-reset",
  "account.signed-out",
  "dashboard.disabled",
  "dashboard.enabled",
  "dashboard.locked",
  "explain.run",
  "requests.cleared",
  "panel.action",
];

const FAILURES = new Set<DevtoolsAuditType>([
  "login.failed",
  "mfa.failed",
  "login.blocked",
  "dashboard.locked",
]);

function query(type: string, account: string, before?: number): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });

  if (type) params.set("type", type);
  if (account) params.set("account", account);
  if (before !== undefined) params.set("before", String(before));

  return `api/admin/audit?${params.toString()}`;
}

/** The audit log: filter by event type and account; "Load older" pages back with `before`. */
export function AuditPage() {
  const [type, setType] = useState("");
  const [account, setAccount] = useState("");
  const [entries, setEntries] = useState<DevtoolsAuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const users = useApi<DevtoolsUserListView>("api/admin/users");

  // A filter change clears the list so the loading state shows while the new page arrives.
  const changeFilter = (set: (value: string) => void, value: string) => {
    set(value);
    setEntries(null);
    setError(null);
  };

  useEffect(() => {
    let current = true;

    apiFetch<DevtoolsAuditEntry[]>(query(type, account)).then(
      (rows) => {
        if (!current) return;

        setEntries(rows);
        setMore(rows.length >= PAGE_SIZE);
      },
      (reason: unknown) => {
        if (current) setError(reason);
      },
    );

    return () => {
      current = false;
    };
  }, [type, account]);

  const loadOlder = useCallback(async () => {
    const last = entries?.at(-1);

    if (!last) return;

    setLoadingOlder(true);
    setError(null);

    try {
      const rows = await apiFetch<DevtoolsAuditEntry[]>(query(type, account, last.at));

      setEntries((previous) => {
        const known = new Set((previous ?? []).map((entry) => entry.id));

        return [...(previous ?? []), ...rows.filter((row) => !known.has(row.id))];
      });
      setMore(rows.length >= PAGE_SIZE);
    } catch (reason) {
      setError(reason);
    } finally {
      setLoadingOlder(false);
    }
  }, [entries, type, account]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Event type
          <select
            className="h-9 rounded-lg border border-input bg-card px-2.5 shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 max-md:h-10"
            value={type}
            onChange={(event) => changeFilter(setType, event.target.value)}
          >
            <option value="">All events</option>
            {AUDIT_TYPES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Account
          <select
            className="h-9 rounded-lg border border-input bg-card px-2.5 shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 max-md:h-10"
            value={account}
            onChange={(event) => changeFilter(setAccount, event.target.value)}
          >
            <option value="">All accounts</option>
            {users.data?.accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.email}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorMessage error={error} />
      {!entries && !error ? <LoadingRows /> : null}
      {entries && entries.length === 0 ? (
        <EmptyState title="No audit entries match." hint="Clear a filter to see more." />
      ) : null}
      {entries && entries.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>Ref</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">
                  {new Date(entry.at).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant={FAILURES.has(entry.type) ? "destructive" : "secondary"}>
                    {entry.type}
                  </Badge>
                </TableCell>
                <TableCell>{entry.email ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{entry.ip ?? "—"}</TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs">
                  {Object.entries(entry.detail)
                    .map(([key, value]) => `${key}=${String(value)}`)
                    .join(" ")}
                </TableCell>
                <TableCell className="font-mono text-xs">{entry.ref}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {entries && more ? (
        <div>
          <Button variant="outline" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? "Loading…" : "Load older"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
