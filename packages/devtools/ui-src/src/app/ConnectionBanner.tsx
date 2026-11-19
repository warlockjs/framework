import { useEffect, useState } from "react";
import { useConnection } from "@/api/connection";

function format(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** A slim bar at the top while the app is unreachable ("Reconnecting to the app…") and briefly "Reconnected" afterwards. */
export function ConnectionBanner() {
  const connection = useConnection();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (connection.phase !== "down") return;

    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(id);
  }, [connection.phase]);

  if (connection.phase === "online") return null;

  const down = connection.phase === "down";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-banner"
      className={`sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 px-4 py-1.5 text-center text-sm font-medium ${
        down ? "bg-warning text-background" : "bg-success text-background"
      }`}
    >
      {down ? (
        <>
          <span>Reconnecting to the app…</span>
          <span className="tabular-nums opacity-90">
            {format(Math.max(now, connection.since) - connection.since)}
          </span>
        </>
      ) : (
        <span>Reconnected</span>
      )}
    </div>
  );
}
