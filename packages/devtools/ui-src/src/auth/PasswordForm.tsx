import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/components/common/ErrorMessage";
import { useAction } from "@/lib/useAction";

export type PasswordFormProps = {
  /** Ask for the current password first (the account page; not the forced change). */
  requireCurrent?: boolean;
  submitLabel: string;
  /** Called with the values; throw (an `ApiError`) to keep the form open with the error. */
  onSubmit: (values: { current?: string; password: string }) => Promise<unknown>;
  /** Called after a successful submit. */
  onDone?: () => void;
};

/** New-password fields with a "type it twice" check; the server applies the password rules and its message is shown as is. */
export function PasswordForm({ requireCurrent, submitLabel, onSubmit, onDone }: PasswordFormProps) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const action = useAction(async () => {
    await onSubmit({ ...(requireCurrent ? { current } : {}), password });
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (password !== repeat) {
      setMismatch(true);

      return;
    }

    setMismatch(false);

    const result = await action.run();

    if (result.ok) {
      setCurrent("");
      setPassword("");
      setRepeat("");
      onDone?.();
    }
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      {requireCurrent ? (
        <div className="grid gap-2">
          <Label htmlFor="pw-current">Current password</Label>
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="pw-new">New password</Label>
        <Input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pw-repeat">Repeat the new password</Label>
        <Input
          id="pw-repeat"
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
      </div>
      {mismatch ? (
        <ErrorMessage message="The two passwords are not the same. Type the same password in both fields." />
      ) : null}
      <ErrorMessage error={action.error} />
      <Button type="submit" disabled={action.pending}>
        {action.pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
