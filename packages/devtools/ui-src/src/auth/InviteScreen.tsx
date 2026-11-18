import { useEffect, useState } from "react";
import type { DevtoolsAuthStepResult, DevtoolsRole } from "@contracts";
import { apiFetch } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { LoadingRows } from "@/components/common/LoadingRows";
import { AuthLayout } from "./AuthLayout";
import { PasswordForm } from "./PasswordForm";

export type InviteScreenProps = {
  /** The invite token read from `#/invite/<token>`. */
  token: string;
  onStep: (result: DevtoolsAuthStepResult) => Promise<void>;
  /** Back to the sign-in screen. */
  onCancel: () => void;
};

/** Accepts an invite: shows the invited email and role, then asks for a password. */
export function InviteScreen({ token, onStep, onCancel }: InviteScreenProps) {
  const [invite, setInvite] = useState<{ email: string; role: DevtoolsRole } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<{ email: string; role: DevtoolsRole }>("api/auth/invite/inspect", {
      method: "POST",
      body: { token },
    }).then(
      (value) => {
        if (!cancelled) setInvite(value);
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthLayout
      title="Accept your invite"
      description="Choose a password to finish creating your account."
    >
      {error ? <ErrorMessage error={error} /> : null}
      {!invite && !error ? <LoadingRows rows={2} /> : null}
      {invite ? (
        <>
          <p className="text-sm">
            <span className="font-medium">{invite.email}</span>{" "}
            <Badge variant="secondary">{invite.role}</Badge>
          </p>
          <PasswordForm
            submitLabel="Create my account"
            onSubmit={async ({ password }) => {
              const result = await apiFetch<DevtoolsAuthStepResult>("api/auth/invite/accept", {
                method: "POST",
                body: { token, password },
              });

              await onStep(result);
            }}
          />
        </>
      ) : null}
      <button
        type="button"
        className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        onClick={onCancel}
      >
        Go to sign in
      </button>
    </AuthLayout>
  );
}
