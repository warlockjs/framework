import { useState, type FormEvent } from "react";
import { renderSVG } from "uqr";
import type { DevtoolsTotpEnrolment } from "@contracts";
import { apiFetch } from "@/api/client";
import type { AuthStepWithCodes } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { useAction } from "@/lib/useAction";

export type TotpEnrolmentProps = {
  /** `api/auth` while enrolling at sign-in, `api/account` from the account page. */
  base: "api/auth" | "api/account";
  /** Called with the answer of the confirmation (it may carry recovery codes). */
  onConfirmed: (result: AuthStepWithCodes) => void;
};

/**
 * Authenticator-app enrolment: starts it, shows the QR code and the secret
 * for manual entry, then confirms with a code from the app.
 */
export function TotpEnrolment({ base, onConfirmed }: TotpEnrolmentProps) {
  const [enrolment, setEnrolment] = useState<DevtoolsTotpEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState("");
  // From the account page the server asks for the password again before a factor is added.
  const askPassword = base === "api/account";
  const start = useAction(async () => {
    setEnrolment(await apiFetch<DevtoolsTotpEnrolment>(`${base}/totp/start`, { method: "POST" }));
  });
  const confirm = useAction(async () => {
    const result = await apiFetch<AuthStepWithCodes | undefined>(`${base}/totp/confirm`, {
      method: "POST",
      body: { code: code.trim(), ...(askPassword ? { current } : {}) },
    });

    onConfirmed(result ?? { stage: "active", csrf: null });
  });

  if (!enrolment) {
    return (
      <div className="grid gap-3">
        <ErrorMessage error={start.error} />
        <Button type="button" disabled={start.pending} onClick={() => void start.run()}>
          {start.pending ? "Starting…" : "Set up an authenticator app"}
        </Button>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void confirm.run();
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        Scan the code with your authenticator app, or type the secret in by hand. Then enter the
        6-digit code the app shows.
      </p>
      <div
        role="img"
        aria-label={`QR code for ${enrolment.account}`}
        className="mx-auto w-48 rounded-md bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
        // The only dangerouslySetInnerHTML in the dashboard: an SVG generated here from the otpauth URI.
        dangerouslySetInnerHTML={{ __html: renderSVG(enrolment.uri) }}
      />
      <p className="text-center text-sm">
        Secret: <code className="font-mono break-all">{enrolment.secret}</code>
      </p>
      <div className="grid gap-2">
        <Label htmlFor="totp-code">Code from the app</Label>
        <Input
          id="totp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      {askPassword ? (
        <div className="grid gap-2">
          <Label htmlFor="totp-current">Current password</Label>
          <Input
            id="totp-current"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
      ) : null}
      <ErrorMessage error={confirm.error} />
      <Button type="submit" disabled={confirm.pending}>
        {confirm.pending ? "Checking…" : "Confirm the code"}
      </Button>
    </form>
  );
}
