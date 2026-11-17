import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "./ErrorMessage";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen and what it affects. */
  description: ReactNode;
  /** The confirm button text (default "Confirm"). */
  confirmLabel?: string;
  /** Styles the confirm button as a destructive action. */
  destructive?: boolean;
  /** When set, the confirm button stays disabled until the user types exactly this word. */
  requireText?: string;
  /** Runs on confirm. The dialog closes when it resolves and stays open, showing the error, when it throws. */
  onConfirm: () => Promise<unknown> | unknown;
};

/**
 * A confirmation before a risky action. It keeps itself open on failure and
 * shows the error inside (with its reference), disables the buttons while the
 * action runs, and can ask the user to type a word first.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  requireText,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) {
      setError(null);
      setTyped("");
    }
  }, [open]);

  const confirm = async () => {
    setPending(true);
    setError(null);

    try {
      await onConfirm();
      onOpenChange(false);
    } catch (reason) {
      setError(reason);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        {requireText ? (
          <div className="grid gap-2">
            <Label htmlFor="confirm-text">
              Type <code className="font-mono">{requireText}</code> to continue
            </Label>
            <Input
              id="confirm-text"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        ) : null}
        <ErrorMessage error={error} />
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending || (requireText !== undefined && typed !== requireText)}
            onClick={confirm}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
