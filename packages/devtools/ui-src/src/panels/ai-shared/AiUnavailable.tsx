import { SparklesIcon } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";

/** Why an AI page is empty: a short title, one line, and a copyable command or detail. */
export function AiUnavailable({
  answer,
}: {
  answer: {
    title?: string | null;
    message?: string | null;
    command?: string | null;
    detail?: string | null;
  };
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-full bg-brand/10 text-brand">
        <SparklesIcon className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold">{answer.title ?? "AI data is not available"}</p>
      {answer.message ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{answer.message}</p>
      ) : null}
      {answer.command ? (
        <div className="mt-4 flex max-w-full items-center gap-2 rounded-md border bg-muted px-3 py-2">
          <code className="overflow-x-auto font-mono text-xs">{answer.command}</code>
          <CopyButton value={answer.command} size="xs" />
        </div>
      ) : null}
      {answer.detail ? (
        <p className="mt-4 max-w-md break-words rounded-md border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
          {answer.detail}
        </p>
      ) : null}
    </div>
  );
}
