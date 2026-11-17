import type { DevtoolsAuthStepResult } from "@contracts";
import { apiFetch } from "@/api/client";
import { AuthLayout } from "./AuthLayout";
import { PasswordForm } from "./PasswordForm";

export type SetupScreenProps = {
  /** The setup token read from `#/setup/<token>`. */
  token: string;
  onStep: (result: DevtoolsAuthStepResult) => Promise<void>;
  /** Back to the sign-in screen. */
  onCancel: () => void;
};

/** First-admin setup: choose a password with the setup token from the link. */
export function SetupScreen({ token, onStep, onCancel }: SetupScreenProps) {
  return (
    <AuthLayout
      title="Set up the first admin"
      description="Choose a password for the admin account. The setup link works once."
    >
      <PasswordForm
        submitLabel="Create the admin account"
        onSubmit={async ({ password }) => {
          const result = await apiFetch<DevtoolsAuthStepResult>("api/auth/setup", {
            method: "POST",
            body: { token, password },
          });

          await onStep(result);
        }}
      />
      <button type="button" className="text-sm text-muted-foreground underline" onClick={onCancel}>
        Go to sign in
      </button>
    </AuthLayout>
  );
}
