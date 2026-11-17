import { useState } from "react";
import type {
  DevtoolsAccountView,
  DevtoolsCreatedInvite,
  DevtoolsInviteView,
  DevtoolsRole,
  DevtoolsUserListView,
} from "@contracts";
import { apiFetch } from "@/api/client";
import { useApi } from "@/api/hooks";
import { useSession } from "@/app/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { LoadingRows } from "@/components/common/LoadingRows";
import { RelativeTime } from "@/components/common/format";
import { useAction } from "@/lib/useAction";

type Pending =
  | { type: "role"; account: DevtoolsAccountView; role: DevtoolsRole }
  | { type: "remove"; account: DevtoolsAccountView }
  | { type: "reset-mfa"; account: DevtoolsAccountView }
  | { type: "sign-out"; account: DevtoolsAccountView }
  | { type: "revoke"; invite: DevtoolsInviteView };

/** The invite link an admin hands over: the token rides in the fragment, never in the URL the server sees. */
export function inviteLink(token: string): string {
  return `${location.origin}${location.pathname}#/invite/${token}`;
}

function InviteForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DevtoolsRole>("viewer");
  const [created, setCreated] = useState<DevtoolsCreatedInvite | null>(null);
  const create = useAction(async () => {
    const result = await apiFetch<DevtoolsCreatedInvite>("api/admin/invites", {
      method: "POST",
      body: { email: email.trim(), role },
    });

    setCreated(result);
    setEmail("");
    onCreated();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite someone</CardTitle>
        <CardDescription>
          You get a link to hand over. It works once and expires in 24 hours. No email is sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create.run();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as DevtoolsRole)}
            >
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <Button type="submit" disabled={create.pending}>
            {create.pending ? "Creating…" : "Create invite"}
          </Button>
        </form>
        <ErrorMessage error={create.error} />
        {created ? (
          <div className="grid gap-2 rounded-md border bg-muted p-3 text-sm">
            <p>
              Invite for <strong>{created.invite.email}</strong> (expires{" "}
              <RelativeTime at={created.invite.expiresAt} />
              ). This link is shown only now:
            </p>
            <code className="font-mono text-xs break-all" data-testid="invite-link">
              {inviteLink(created.token)}
            </code>
            <div className="flex gap-2">
              <CopyButton value={inviteLink(created.token)} label="Copy link" />
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                Hide
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function dialogFor(pending: Pending): { title: string; description: string; label: string } {
  switch (pending.type) {
    case "role":
      return {
        title: `Make ${pending.account.email} ${pending.role === "admin" ? "an admin" : "a viewer"}?`,
        description:
          pending.role === "admin"
            ? "Admins manage users and can turn the dashboard off. They are asked to add a second factor at the next sign-in."
            : "They lose access to user management and settings.",
        label: "Change role",
      };
    case "remove":
      return {
        title: `Remove ${pending.account.email}?`,
        description: "The account and its sessions are deleted. This cannot be undone.",
        label: "Remove",
      };
    case "reset-mfa":
      return {
        title: `Reset the second factor of ${pending.account.email}?`,
        description:
          "Their authenticator app, passkeys and recovery codes are removed. They add new ones at the next sign-in.",
        label: "Reset",
      };
    case "sign-out":
      return {
        title: `Sign ${pending.account.email} out everywhere?`,
        description: "Every browser session of this account ends at once.",
        label: "Sign out",
      };
    case "revoke":
      return {
        title: `Revoke the invite for ${pending.invite.email}?`,
        description: "The link stops working.",
        label: "Revoke",
      };
  }
}

/** Users and invites: the accounts, pending invites, and the invite form. */
export function UsersPage() {
  const { session } = useSession();
  const users = useApi<DevtoolsUserListView>("api/admin/users");
  const [pending, setPending] = useState<Pending | null>(null);

  const run = async () => {
    if (!pending) return;

    switch (pending.type) {
      case "role":
        await apiFetch(`api/admin/users/${pending.account.id}`, {
          method: "PATCH",
          body: { role: pending.role },
        });
        break;
      case "remove":
        await apiFetch(`api/admin/users/${pending.account.id}`, { method: "DELETE" });
        break;
      case "reset-mfa":
        await apiFetch(`api/admin/users/${pending.account.id}/reset-mfa`, { method: "POST" });
        break;
      case "sign-out":
        await apiFetch(`api/admin/users/${pending.account.id}/sign-out`, { method: "POST" });
        break;
      case "revoke":
        await apiFetch(`api/admin/invites/${pending.invite.id}`, { method: "DELETE" });
        break;
    }

    users.reload();
  };

  const texts = pending ? dialogFor(pending) : null;

  return (
    <div className="grid gap-4">
      <InviteForm onCreated={users.reload} />
      {users.error && !users.data ? <ErrorMessage error={users.error} /> : null}
      {!users.data && !users.error ? <LoadingRows /> : null}
      {users.data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Second factor</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data.accounts.map((account) => {
                    const self = account.id === session.account?.id;

                    return (
                      <TableRow key={account.id}>
                        <TableCell>
                          {account.email} {self ? <Badge variant="outline">You</Badge> : null}
                        </TableCell>
                        <TableCell>{account.role}</TableCell>
                        <TableCell>
                          {account.twoFactor.totp || account.twoFactor.passkeys.length > 0
                            ? "On"
                            : "Off"}
                        </TableCell>
                        <TableCell>
                          <RelativeTime at={account.lastLoginAt} />
                        </TableCell>
                        <TableCell className="flex flex-wrap justify-end gap-1">
                          {self ? null : (
                            <>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  setPending({
                                    type: "role",
                                    account,
                                    role: account.role === "admin" ? "viewer" : "admin",
                                  })
                                }
                              >
                                {account.role === "admin" ? "Make viewer" : "Make admin"}
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => setPending({ type: "reset-mfa", account })}
                              >
                                Reset second factor
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => setPending({ type: "sign-out", account })}
                              >
                                Sign out everywhere
                              </Button>
                              <Button
                                size="xs"
                                variant="destructive"
                                onClick={() => setPending({ type: "remove", account })}
                              >
                                Remove
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pending invites</CardTitle>
            </CardHeader>
            <CardContent>
              {users.data.invites.filter((invite) => invite.usedAt === null).length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending invites.</p>
              ) : (
                <Table>
                  <TableBody>
                    {users.data.invites
                      .filter((invite) => invite.usedAt === null)
                      .map((invite) => (
                        <TableRow key={invite.id}>
                          <TableCell>{invite.email}</TableCell>
                          <TableCell>{invite.role}</TableCell>
                          <TableCell>
                            expires <RelativeTime at={invite.expiresAt} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => setPending({ type: "revoke", invite })}
                            >
                              Revoke
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
      {texts ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={texts.title}
          description={texts.description}
          confirmLabel={texts.label}
          destructive={pending?.type === "remove"}
          onConfirm={run}
        />
      ) : null}
    </div>
  );
}
