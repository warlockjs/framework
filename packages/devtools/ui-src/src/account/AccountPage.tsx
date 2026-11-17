import { useState } from "react";
import type {
  DevtoolsAccountView,
  DevtoolsAuthStepResult,
  DevtoolsRecoveryCodes,
  DevtoolsSessionInfo,
} from "@contracts";
import { apiFetch, setCsrfToken } from "@/api/client";
import { useApi } from "@/api/hooks";
import { PasswordForm } from "@/auth/PasswordForm";
import { registerPasskey } from "@/auth/passkeys";
import { RecoveryCodes } from "@/auth/RecoveryCodes";
import { TotpEnrolment } from "@/auth/TotpEnrolment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { LoadingRows } from "@/components/common/LoadingRows";
import { RelativeTime } from "@/components/common/format";
import { useAction } from "@/lib/useAction";

type Reload = { reload: () => void };

function PasswordSection() {
  const [changed, setChanged] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it asks for the current one.</CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-sm gap-3">
        <PasswordForm
          requireCurrent
          submitLabel="Change password"
          onSubmit={async ({ current, password }) => {
            const result = await apiFetch<DevtoolsAuthStepResult | undefined>("api/account/password", {
              method: "POST",
              body: { current, password },
            });

            if (result?.csrf) setCsrfToken(result.csrf);
          }}
          onDone={() => setChanged(true)}
        />
        {changed ? <p role="status" className="text-sm">Password changed.</p> : null}
      </CardContent>
    </Card>
  );
}

function TotpSection({ account, reload }: { account: DevtoolsAccountView } & Reload) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authenticator app</CardTitle>
        <CardDescription>
          {account.twoFactor.totp ? "An authenticator app is set up." : "No authenticator app yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-md gap-3">
        {codes ? (
          <RecoveryCodes
            codes={codes}
            onDone={() => {
              setCodes(null);
              reload();
            }}
          />
        ) : account.twoFactor.totp ? (
          <div>
            <Button variant="outline" onClick={() => setRemoving(true)}>
              Remove the authenticator app
            </Button>
          </div>
        ) : adding ? (
          <TotpEnrolment
            base="api/account"
            onConfirmed={(result) => {
              setAdding(false);

              if (result.recoveryCodes?.length) setCodes(result.recoveryCodes);
              else reload();
            }}
          />
        ) : (
          <div>
            <Button onClick={() => setAdding(true)}>Add an authenticator app</Button>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the authenticator app?"
        description="You will no longer be asked for its code. If it is your only second factor, the server refuses and says what to add first."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await apiFetch("api/account/totp", { method: "DELETE" });
          reload();
        }}
      />
    </Card>
  );
}

function PasskeysSection({ account, reload }: { account: DevtoolsAccountView } & Reload) {
  const [removeId, setRemoveId] = useState<string | null>(null);
  const add = useAction(async () => {
    await registerPasskey("api/account");
    reload();
  });
  const passkeys = account.twoFactor.passkeys;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passkeys</CardTitle>
        <CardDescription>Sign in with a device key instead of a code.</CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-3">
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No passkeys yet.</p>
        ) : (
          <ul className="grid gap-2">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {passkey.name}{" "}
                  <span className="text-muted-foreground">
                    · last used <RelativeTime at={passkey.lastUsedAt} />
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => setRemoveId(passkey.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ErrorMessage error={add.error} />
        <div>
          <Button disabled={add.pending} onClick={() => void add.run()}>
            {add.pending ? "Waiting for the passkey…" : "Add a passkey"}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={removeId !== null}
        onOpenChange={(open) => !open && setRemoveId(null)}
        title="Remove this passkey?"
        description="It will stop working for sign-in. If it is your only second factor, the server refuses and says what to add first."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await apiFetch(`api/account/passkeys/${removeId ?? ""}`, { method: "DELETE" });
          reload();
        }}
      />
    </Card>
  );
}

function RecoverySection({ account, reload }: { account: DevtoolsAccountView } & Reload) {
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const regenerate = useAction(async () => {
    const result = await apiFetch<DevtoolsRecoveryCodes>("api/account/recovery-codes", {
      method: "POST",
      body: { code: code.trim() },
    });

    setCode("");
    setCodes(result.codes);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery codes</CardTitle>
        <CardDescription>
          {account.twoFactor.recoveryCodesLeft} left. Making new ones replaces the old ones.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-md gap-3">
        {codes ? (
          <RecoveryCodes
            codes={codes}
            onDone={() => {
              setCodes(null);
              reload();
            }}
          />
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void regenerate.run();
            }}
          >
            <Label htmlFor="regen-code">Current code from your authenticator app</Label>
            <Input
              id="regen-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <ErrorMessage error={regenerate.error} />
            <div>
              <Button type="submit" disabled={regenerate.pending}>
                {regenerate.pending ? "Working…" : "Make new recovery codes"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsSection() {
  const sessions = useApi<DevtoolsSessionInfo[]>("api/account/sessions");
  const [revoke, setRevoke] = useState<DevtoolsSessionInfo | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Where you are signed in. Revoke any you do not recognise.</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.error && !sessions.data ? <ErrorMessage error={sessions.error} /> : null}
        {!sessions.data && !sessions.error ? <LoadingRows rows={2} /> : null}
        {sessions.data ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Browser</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-64 truncate" title={item.userAgent ?? undefined}>
                    {item.userAgent ?? "Unknown"} {item.current ? <Badge>This session</Badge> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.ip ?? "—"}</TableCell>
                  <TableCell>
                    <RelativeTime at={item.lastSeenAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    {item.current ? null : (
                      <Button size="sm" variant="outline" onClick={() => setRevoke(item)}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={revoke !== null}
        onOpenChange={(open) => !open && setRevoke(null)}
        title="Revoke this session?"
        description="That browser is signed out at once."
        confirmLabel="Revoke"
        destructive
        onConfirm={async () => {
          await apiFetch(`api/account/sessions/${revoke?.id ?? ""}`, { method: "DELETE" });
          sessions.reload();
        }}
      />
    </Card>
  );
}

/** Your account: password, authenticator app, passkeys, recovery codes and sessions. */
export function AccountPage() {
  const account = useApi<DevtoolsAccountView>("api/account");

  if (account.error && !account.data) return <ErrorMessage error={account.error} />;
  if (!account.data) return <LoadingRows />;

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div>
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="text-sm text-muted-foreground">
          {account.data.email} <Badge variant="secondary">{account.data.role}</Badge>
        </p>
      </div>
      <PasswordSection />
      <TotpSection account={account.data} reload={account.reload} />
      <PasskeysSection account={account.data} reload={account.reload} />
      <RecoverySection account={account.data} reload={account.reload} />
      <SessionsSection />
    </div>
  );
}
