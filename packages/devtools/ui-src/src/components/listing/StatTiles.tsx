import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_TEXT, type PillTone } from "./Pill";

export type StatTile = {
  label: string;
  value: ReactNode;
  /** A short note under the value ("of 310 requests"). */
  hint?: ReactNode;
  /** Colours the value when the number deserves attention. */
  tone?: PillTone;
};

/** A strip of 3 to 5 figures computed from what the tab already loaded. */
export function StatTiles({ items, label = "Summary" }: { items: StatTile[]; label?: string }) {
  return (
    <dl
      aria-label={label}
      className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]"
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
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.hint}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
