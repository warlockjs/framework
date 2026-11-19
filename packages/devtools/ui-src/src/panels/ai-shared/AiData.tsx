import type { ReactNode } from "react";
import type { DevtoolsAiUnavailableView } from "@contracts";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { ApiState } from "@/api/hooks";
import { ErrorMessage, LoadingRows } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TONE_TEXT, type PillTone } from "@/components/listing";
import { cn } from "@/lib/utils";
import { AiUnavailable } from "./AiUnavailable";

type AvailableOf<T> = Exclude<T, DevtoolsAiUnavailableView>;

/**
 * The states every AI page shares: the first load, an error with its reference
 * (the previous data stays under it), the unavailable answer, and the data at
 * reduced opacity while a refetch runs.
 */
export function AiData<T extends DevtoolsAiUnavailableView | { available: true }>({
  api,
  errorTitle,
  children,
}: {
  api: Pick<ApiState<T>, "data" | "error" | "reload" | "loading">;
  /** What failed, as a short heading ("Could not load the AI report"). */
  errorTitle: string;
  children: (data: AvailableOf<T>, refreshing: boolean) => ReactNode;
}) {
  const { data, error, loading, reload } = api;

  return (
    <>
      {error ? (
        <ErrorMessage error={error} title={errorTitle} onRetry={reload} className="mb-3" />
      ) : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.available ? (
        <AiUnavailable answer={data as DevtoolsAiUnavailableView} />
      ) : null}
      {data?.available ? (
        <div className={cn("transition-opacity", loading && "opacity-60")}>
          {children(data as AvailableOf<T>, loading)}
        </div>
      ) : null}
    </>
  );
}

/** A note above the page: unpriced models, or observation turned off. */
export function AiBanner({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "info";
  children: ReactNode;
}) {
  const Icon = tone === "warning" ? TriangleAlertIcon : InfoIcon;

  return (
    <Alert variant={tone} className="mb-3">
      <Icon aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export const OBSERVATION_OFF_TEXT =
  "AI observation is off, so new runs are not counted and the figures below are older ones. To count new runs, call ai.config({ panoptic: { observeAll: true } }) and restart the app.";

export type KpiTile = {
  label: string;
  value: ReactNode;
  /** The line under the value. */
  hint?: ReactNode;
  /** The change against the previous period. */
  delta?: ReactNode;
  tone?: PillTone;
};

/** The headline figures of a page, each with a hint line and an optional change against the previous period. */
export function KpiTiles({ items, label }: { items: KpiTile[]; label: string }) {
  return (
    <dl
      aria-label={label}
      className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))]"
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-xl border bg-card px-3.5 py-3">
          <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
          <dd
            className={cn(
              "mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums",
              TONE_TEXT[item.tone ?? "neutral"],
            )}
          >
            {item.value}
          </dd>
          {item.hint ? (
            <p className="mt-0.5 text-xs break-words text-muted-foreground">{item.hint}</p>
          ) : null}
          {item.delta ? <p className="mt-0.5">{item.delta}</p> : null}
        </div>
      ))}
    </dl>
  );
}
