import { useState } from "react";
import type { DevtoolsCreatedShare, DevtoolsShareList, DevtoolsShareView } from "@contracts";
import { apiFetch } from "@/api/client";
import { useApi } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CopyButton } from "@/components/common/CopyButton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { LoadingRows } from "@/components/common/LoadingRows";
import { RelativeTime } from "@/components/common/format";
import { sharePanelOf } from "@/lib/route";
import { useAction } from "@/lib/useAction";

const LABEL_MAX = 80;

function CreateDialog({
  list,
  open,
  onOpenChange,
  onCreated,
}: {
  list: DevtoolsShareList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: DevtoolsCreatedShare) => void;
}) {
  const wanted = sharePanelOf(location.hash);
  const [panel, setPanel] = useState(
    list.panels.find((item) => item.id === wanted)?.id ?? list.panels[0]?.id ?? "",
  );
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(String(Math.min(7, list.maxDays)));
  const create = useAction(async () => {
    const created = await apiFetch<DevtoolsCreatedShare>("api/admin/shares", {
      method: "POST",
      body: { panel, label: label.trim(), days: Number(days) },
    });

    setLabel("");
    onCreated(created);
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a share link</DialogTitle>
          <DialogDescription>
            Anyone with the link can read the shared view of the panel until the link expires or you
            revoke it. They need no account and cannot change anything.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create.run();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="share-panel">Panel</Label>
            <select
              id="share-panel"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={panel}
              onChange={(event) => setPanel(event.target.value)}
            >
              {list.panels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="share-label">Label</Label>
            <Input
              id="share-label"
              required
              maxLength={LABEL_MAX}
              placeholder="Who or what is this link for?"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="share-days">Days until it expires (1 to {list.maxDays})</Label>
            <Input
              id="share-days"
              type="number"
              required
              min={1}
              max={list.maxDays}
              step={1}
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </div>
          <ErrorMessage error={create.error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.pending || list.panels.length === 0}>
              {create.pending ? "Creating…" : "Create link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function statusBadge(share: DevtoolsShareView) {
  return <Badge variant={share.status === "active" ? "default" : "outline"}>{share.status}</Badge>;
}

/** Share links: the list with status, a create dialog, the one-time URL, revoke and revoke all. */
export function SharesPage() {
  const shares = useApi<DevtoolsShareList>("api/admin/shares");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<DevtoolsCreatedShare | null>(null);
  const [revoking, setRevoking] = useState<DevtoolsShareView | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const data = shares.data;
  const titleOf = (id: string) => data?.panels.find((item) => item.id === id)?.title ?? id;
  const active = data?.shares.filter((share) => share.status === "active").length ?? 0;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Share links</CardTitle>
          <CardDescription>
            A read-only link opens one panel&apos;s shared view without an account. The link is
            shown once, expires on its own and can be revoked at any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => setCreating(true)} disabled={!data || data.panels.length === 0}>
            Create a link
          </Button>
          <Button variant="outline" disabled={active === 0} onClick={() => setRevokingAll(true)}>
            Revoke all links
          </Button>
        </CardContent>
      </Card>

      {created ? (
        <Card>
          <CardHeader>
            <CardTitle>Link for {created.share.label}</CardTitle>
            <CardDescription>
              This link is shown only now. Copy it and hand it over; it cannot be shown again.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <code className="font-mono text-xs break-all" data-testid="share-link">
              {created.url}
            </code>
            <div className="flex gap-2">
              <CopyButton value={created.url} label="Copy link" />
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                Hide
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {shares.error && !data ? <ErrorMessage error={shares.error} onRetry={shares.reload} /> : null}
      {!data && !shares.error ? <LoadingRows /> : null}
      {data && data.panels.length === 0 ? (
        <EmptyState
          title="No panel can be shared."
          hint="A panel needs a shared view (share) before it can have links. Add a panel that declares one, such as the Grimoire panel."
        />
      ) : null}
      {data && data.shares.length === 0 && data.panels.length > 0 ? (
        <EmptyState title="No links yet." hint="Create a link to share a panel read-only." />
      ) : null}
      {data && data.shares.length > 0 ? (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Panel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.shares.map((share) => (
                  <TableRow key={share.id}>
                    <TableCell>
                      {share.label}
                      {share.createdBy ? (
                        <span className="block text-xs text-muted-foreground">
                          by {share.createdBy}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{titleOf(share.panel)}</TableCell>
                    <TableCell>{statusBadge(share)}</TableCell>
                    <TableCell>
                      <RelativeTime at={share.expiresAt} />
                    </TableCell>
                    <TableCell>
                      <RelativeTime at={share.lastUsedAt} />
                    </TableCell>
                    <TableCell>{share.uses}</TableCell>
                    <TableCell className="text-right">
                      {share.status === "active" ? (
                        <Button size="xs" variant="outline" onClick={() => setRevoking(share)}>
                          Revoke
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {data && creating ? (
        <CreateDialog
          list={data}
          open
          onOpenChange={setCreating}
          onCreated={(next) => {
            setCreated(next);
            shares.reload();
          }}
        />
      ) : null}
      {revoking ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRevoking(null)}
          title={`Revoke the link "${revoking.label}"?`}
          description="The link stops working within a few seconds, on every instance."
          confirmLabel="Revoke"
          destructive
          onConfirm={async () => {
            await apiFetch(`api/admin/shares/${revoking.id}`, { method: "DELETE" });
            shares.reload();
          }}
        />
      ) : null}
      {revokingAll ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRevokingAll(false)}
          title="Revoke every share link?"
          description={`All ${active} active links stop working within a few seconds. This cannot be undone.`}
          confirmLabel="Revoke all"
          destructive
          requireText="revoke all"
          onConfirm={async () => {
            await apiFetch("api/admin/shares/revoke-all", { method: "POST" });
            shares.reload();
          }}
        />
      ) : null}
    </div>
  );
}
