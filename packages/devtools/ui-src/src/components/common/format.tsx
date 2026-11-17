import { useEffect, useState } from "react";

/** Milliseconds as "12 ms", "1.4 s", "2.5 min" or "1.2 h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1) return `${Math.round(ms * 100) / 100} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 6000) / 10} min`;

  return `${Math.round(ms / 360_000) / 10} h`;
}

/** Bytes as "512 B", "1.5 KB", "20.3 MB" (1024 based). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.abs(bytes);
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const text = unit === 0 ? String(Math.round(value)) : (Math.round(value * 10) / 10).toString();

  return `${bytes < 0 ? "-" : ""}${text} ${units[unit]}`;
}

/** An epoch time as "just now", "5 min ago", "2 h ago" or "3 d ago" (or "in 5 min" for the future). */
export function formatRelativeTime(at: number, now: number = Date.now()): string {
  const diff = now - at;
  const abs = Math.abs(diff);
  const suffix = (text: string) => (diff >= 0 ? `${text} ago` : `in ${text}`);

  if (abs < 5000) return "just now";
  if (abs < 60_000) return suffix(`${Math.round(abs / 1000)} s`);
  if (abs < 3_600_000) return suffix(`${Math.round(abs / 60_000)} min`);
  if (abs < 86_400_000) return suffix(`${Math.round(abs / 3_600_000)} h`);

  return suffix(`${Math.round(abs / 86_400_000)} d`);
}

export type DurationProps = {
  /** Milliseconds. */
  ms: number | null | undefined;
  className?: string;
};

/** A duration in milliseconds as "12 ms" or "1.4 s"; "—" when absent. */
export function Duration({ ms, className }: DurationProps) {
  return <span className={className}>{ms === null || ms === undefined ? "—" : formatDuration(ms)}</span>;
}

export type BytesProps = {
  bytes: number | null | undefined;
  className?: string;
};

/** A size in bytes as "1.5 KB" or "20.3 MB"; "—" when absent. */
export function Bytes({ bytes, className }: BytesProps) {
  return <span className={className}>{bytes === null || bytes === undefined ? "—" : formatBytes(bytes)}</span>;
}

export type RelativeTimeProps = {
  /** Epoch milliseconds. */
  at: number | null | undefined;
  /** Shown when `at` is absent (default "never"). */
  fallback?: string;
  className?: string;
};

/** An epoch time as "5 min ago" in a `<time>` element (full date as its title); it refreshes every 30 seconds. */
export function RelativeTime({ at, fallback = "never", className }: RelativeTimeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);

    return () => clearInterval(id);
  }, []);

  if (at === null || at === undefined) return <span className={className}>{fallback}</span>;

  return (
    <time className={className} dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
      {formatRelativeTime(at, now)}
    </time>
  );
}
