import { useState, type FormEvent } from "react";
import type { DevtoolsAuthStepResult } from "@contracts";
import { apiFetch } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { useAction } from "@/lib/useAction";
import { AuthLayout } from "./AuthLayout";

export type LoginScreenProps = {
  /** A note above the form, such as "Your session ended. Sign in again." */
  notice?: string | null;
  onStep: (result: DevtoolsAuthStepResult) => Promise<void>;
};

/** Email and password sign-in. */
export function LoginScreen({ notice, onStep }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const action = useAction(async () => {
    const result = await apiFetch<DevtoolsAuthStepResult>("api/auth/login", {
      method: "POST",
      body: { email, password },
    });

    await onStep(result);
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run();
  };

  return (
    <AuthLayout title="Sign in" description="Use the account an admin created for you.">
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <ErrorMessage error={action.error} />
        <Button type="submit" disabled={action.pending}>
          {action.pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
