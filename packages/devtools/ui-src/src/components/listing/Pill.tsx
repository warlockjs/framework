import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DASH } from "@/components/ui/panel-kit";

export type PillTone = "success" | "warning" | "info" | "destructive" | "brand" | "neutral";

const TONES: Record<PillTone, string> = {
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-info/25 bg-info/10 text-info",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
  brand: "border-brand/25 bg-brand/10 text-brand",
  neutral: "border-border bg-muted text-muted-foreground",
};

/** The text colour of a tone, for figures that are not pills. */
export const TONE_TEXT: Record<PillTone, string> = {
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  destructive: "text-destructive",
  brand: "text-brand",
  neutral: "text-foreground",
};

/** A small rounded label with a colour that says what kind of thing it names. */
export function Pill({
  tone = "neutral",
  mono,
  className,
  children,
  ...props
}: {
  tone?: PillTone;
  mono?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"span">, "children" | "className">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-none font-medium whitespace-nowrap",
        mono && "font-mono tabular-nums",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** 2xx success, 3xx info, 4xx warning, 5xx destructive. */
export function statusPillTone(status: number | null | undefined): PillTone {
  if (status == null) return "neutral";
  if (status >= 500) return "destructive";
  if (status >= 400) return "warning";
  if (status >= 300) return "info";

  return "success";
}

export function StatusPill({ status }: { status: number | null | undefined }) {
  return (
    <Pill tone={statusPillTone(status)} mono>
      {status ?? DASH}
    </Pill>
  );
}

const METHOD_TONES: Record<string, PillTone> = {
  GET: "info",
  POST: "success",
  PUT: "warning",
  PATCH: "warning",
  DELETE: "destructive",
};

export function MethodPill({ method }: { method: string }) {
  const upper = method.toUpperCase();

  return (
    <Pill tone={METHOD_TONES[upper] ?? "neutral"} mono className="min-w-14 justify-center">
      {upper}
    </Pill>
  );
}

export function levelPillTone(level: string): PillTone {
  switch (level) {
    case "error":
      return "destructive";
    case "warn":
      return "warning";
    case "success":
      return "success";
    case "debug":
      return "neutral";
    default:
      return "info";
  }
}

export function LevelPill({ level }: { level: string }) {
  return (
    <Pill tone={levelPillTone(level)} className="min-w-14 justify-center">
      {level}
    </Pill>
  );
}
