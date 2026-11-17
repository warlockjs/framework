import type { DevtoolsAuthStepResult } from "@contracts";
import { apiFetch } from "@/api/client";
import { AuthLayout } from "./AuthLayout";
import { PasswordForm } from "./PasswordForm";

export type PasswordChangeScreenProps = {
  onStep: (result: DevtoolsAuthStepResult) => Promise<void>;
  onSignOut: () => Promise<void>;
};

/** The forced password change (a password set by an admin or from the environment): no current password is asked. */
export function PasswordChangeScreen({ onStep, onSignOut }: PasswordChangeScreenProps) {
  return (
    <AuthLayout
      title="Choose a new password"
      description="The password you signed in with was set for you. Choose your own to continue."
    >
      <PasswordForm
        submitLabel="Save the new password"
        onSubmit={async ({ password }) => {
          const result = await apiFetch<DevtoolsAuthStepResult>("api/auth/password", {
            method: "POST",
            body: { password },
          });

          await onStep(result);
        }}
      />
      <button
        type="button"
        className="text-sm text-muted-foreground underline"
        onClick={() => void onSignOut()}
      >
        Sign out
      </button>
    </AuthLayout>
  );
}
