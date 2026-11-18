import { useState, type FormEvent } from "react";
import type { DevtoolsAuthStepResult, DevtoolsSessionView } from "@contracts";
import { apiFetch } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { useAction } from "@/lib/useAction";
import { AuthLayout } from "./AuthLayout";
import { authenticateWithPasskey } from "./passkeys";

export type MfaVerifyScreenProps = {
  session: DevtoolsSessionView;
  onStep: (result: DevtoolsAuthStepResult) => Promise<void>;
  onSignOut: () => Promise<void>;
};

/** The second-factor step: an authenticator code, a recovery code, or a passkey when the server offers them. */
export function MfaVerifyScreen({ session, onStep, onSignOut }: MfaVerifyScreenProps) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const verify = useAction(async () => {
    const result = await apiFetch<DevtoolsAuthStepResult>("api/auth/mfa", {
      method: "POST",
      body: useRecovery ? { recoveryCode: value.trim() } : { code: value.trim() },
    });

    await onStep(result);
  });
  const passkey = useAction(async () => {
    await onStep(await authenticateWithPasskey());
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void verify.run();
  };

  return (
    <AuthLayout
      title="Second step"
      description={
        useRecovery
          ? "Enter one of your recovery codes. Each works once."
          : "Enter the 6-digit code from your authenticator app."
      }
    >
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-2">
          <Label htmlFor="mfa-value">{useRecovery ? "Recovery code" : "Code"}</Label>
          <Input
            id="mfa-value"
            required
            autoComplete="one-time-code"
            inputMode={useRecovery ? "text" : "numeric"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <ErrorMessage error={verify.error} />
        <Button type="submit" disabled={verify.pending}>
          {verify.pending ? "Checking…" : "Verify"}
        </Button>
      </form>
      <button
        type="button"
        className="rounded-sm text-sm underline underline-offset-4"
        onClick={() => {
          setUseRecovery((previous) => !previous);
          setValue("");
          verify.clear();
        }}
      >
        {useRecovery ? "Use the authenticator app" : "Use a recovery code"}
      </button>
      {session.methods?.passkeys ? (
        <div className="grid gap-2">
          <ErrorMessage error={passkey.error} />
          <Button
            type="button"
            variant="outline"
            disabled={passkey.pending}
            onClick={() => void passkey.run()}
          >
            {passkey.pending ? "Waiting for the passkey…" : "Use a passkey"}
          </Button>
        </div>
      ) : null}
      <button
        type="button"
        className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        onClick={() => void onSignOut()}
      >
        Sign out
      </button>
    </AuthLayout>
  );
}
