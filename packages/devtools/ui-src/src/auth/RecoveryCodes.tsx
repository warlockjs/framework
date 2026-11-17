import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/common/CopyButton";

export type RecoveryCodesProps = {
  codes: readonly string[];
  /** Called when the user confirms they saved the codes. */
  onDone: () => void;
  /** The confirm button text (default "Continue"). */
  doneLabel?: string;
};

/**
 * Shows recovery codes once, with copy and download, and asks the user to
 * confirm they saved them ("I saved them") before going on.
 */
export function RecoveryCodes({ codes, onDone, doneLabel = "Continue" }: RecoveryCodesProps) {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");

  const download = () => {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: "text/plain" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = "warlock-devtools-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Each code works once if you lose your authenticator. They are shown only now: save them
        somewhere safe before you continue.
      </p>
      <ul
        className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-3 font-mono text-sm"
        aria-label="Recovery codes"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton value={text} label="Copy codes" />
        <Button type="button" size="sm" variant="outline" onClick={download}>
          <DownloadIcon />
          Download .txt
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        I saved them
      </label>
      <Button type="button" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}
