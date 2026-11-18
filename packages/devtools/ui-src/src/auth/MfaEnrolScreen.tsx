import { useState } from "react";
import type { DevtoolsAuthStepResult, DevtoolsSessionView } from "@contracts";
import { setCsrfToken } from "@/api/client";
import type { AuthStepWithCodes } from "@/api/types";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { useAction } from "@/lib/useAction";
import { AuthLayout } from "./AuthLayout";
import { registerPasskey } from "./passkeys";
import { RecoveryCodes } from "./RecoveryCodes";
import { TotpEnrolment } from "./TotpEnrolment";

export type MfaEnrolScreenProps = {
  session: DevtoolsSessionView;
  onStep: (result: DevtoolsAuthStepResult) => Promise<void>;
  onSignOut: () => Promise<void>;
};

/**
 * The enrolment step: the account must add a second factor (authenticator
 * app, or a passkey when the server offers them). When the first factor is
 * confirmed the recovery codes are shown once, and sign-in continues only
 * after the user confirms they saved them.
 */
export function MfaEnrolScreen({ session, onStep, onSignOut }: MfaEnrolScreenProps) {
  const [done, setDone] = useState<AuthStepWithCodes | null>(null);
  const finish = (result: AuthStepWithCodes) => {
    // The session token changed on this step: later calls need the new CSRF token before the next screen loads.
    if (result.csrf) setCsrfToken(result.csrf);

    setDone(result);
  };

  const passkey = useAction(async () => {
    finish(await registerPasskey("api/auth"));
  });

  if (done) {
    const codes = done.recoveryCodes ?? [];

    return (
      <AuthLayout title="Save your recovery codes" wide>
        {codes.length > 0 ? (
          <RecoveryCodes codes={codes} onDone={() => void onStep(done)} />
        ) : (
          <Button onClick={() => void onStep(done)}>Continue</Button>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Add a second sign-in step"
      description="Your account needs a second factor. Add one now; you will use it at every sign-in."
      wide
    >
      <TotpEnrolment base="api/auth" onConfirmed={finish} />
      {session.methods?.passkeys ? (
        <div className="grid gap-3 border-t pt-4">
          <ErrorMessage error={passkey.error} />
          <Button
            type="button"
            variant="outline"
            disabled={passkey.pending}
            onClick={() => void passkey.run()}
          >
            {passkey.pending ? "Waiting for the passkey…" : "Add a passkey instead"}
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
