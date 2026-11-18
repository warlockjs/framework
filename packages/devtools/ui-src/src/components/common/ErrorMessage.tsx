import { TriangleAlertIcon } from "lucide-react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type ErrorMessageProps = {
  /** The failure. An `ApiError` carries the server's message and reference; any other `Error` shows its message. */
  error?: unknown;
  /** A message to show when there is no `error` object. */
  message?: string;
  /** A reference to quote to support; taken from an `ApiError` when omitted. */
  reference?: string | null;
  /** A short heading above the message. */
  title?: string;
  /** Shows a "Try again" button that calls this. */
  onRetry?: () => void;
  className?: string;
};

/** The text of a failure: the server's own message for an `ApiError`, the message of any `Error`, else a fallback that says what to do. */
export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;

  return "The action failed. Try again; if it keeps failing, check the server log.";
}

/**
 * Shows what failed and what to do next (the server's `error` text), and the
 * short reference id to quote to an admin when the server sent one. Renders
 * nothing when there is neither an `error` nor a `message`. Place it where
 * the action happened (inside the open dialog or next to the form).
 */
export function ErrorMessage({
  error,
  message,
  reference,
  title,
  onRetry,
  className,
}: ErrorMessageProps) {
  if (!error && !message) return null;

  const text = message ?? errorText(error);
  const ref = reference ?? (error instanceof ApiError ? error.ref : null);

  return (
    <Alert variant="destructive" className={cn("text-left", className)}>
      <TriangleAlertIcon aria-hidden="true" />
      <AlertDescription className="text-destructive">
        {title ? <AlertTitle>{title}</AlertTitle> : null}
        <p>{text}</p>
        {ref ? <p className="font-mono text-xs opacity-90">Reference: {ref}</p> : null}
        {onRetry ? (
          <Button variant="outline" size="xs" className="mt-2" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
