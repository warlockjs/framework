import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CopyButtonProps = {
  /** The text put on the clipboard. */
  value: string;
  /** The button text (default "Copy"). */
  label?: string;
  size?: "default" | "sm" | "xs";
  variant?: "default" | "outline" | "secondary" | "ghost";
};

/** Copies `value` to the clipboard; when the browser refuses, it says so and asks the user to select the text. */
export function CopyButton({ value, label = "Copy", size = "sm", variant = "outline" }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  };

  return (
    <>
      <Button type="button" size={size} variant={variant} onClick={copy}>
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
        {state === "copied" ? "Copied" : label}
      </Button>
      {state === "failed" ? (
        <span role="status" className="text-xs text-destructive">
          The browser blocked copying. Select the text and copy it by hand.
        </span>
      ) : null}
    </>
  );
}
