import { log } from "@warlock.js/logger";
import { type DashboardServer, queueDashboard } from "./dashboard";
import { QueueDashboardUnguardedError } from "./queue-dashboard-unguarded.error";
import type { QueueConfig } from "./types";

/** Default path the dashboard mounts on when `dashboard.path` is not set. */
export const DEFAULT_DASHBOARD_PATH = "/admin/queues";

/**
 * Mount the bull-board dashboard for `queue.dashboard` in `config`, applying
 * the safety rule: `enabled` in production with no middleware throws
 * {@link QueueDashboardUnguardedError} instead of booting exposed; outside
 * production with no middleware it logs one warning and mounts anyway.
 *
 * Called by `queueConnector()` at boot, once the HTTP server exists but
 * before it starts listening — see `queue-connector.ts`. Exported so it can
 * be unit-tested without going through the whole connector lifecycle.
 */
export async function mountQueueDashboard(
  server: DashboardServer | undefined,
  config: QueueConfig,
): Promise<void> {
  const dashboard = config.dashboard;

  if (!dashboard?.enabled) {
    return;
  }

  const middlewareList = dashboard.middleware ?? [];

  if (middlewareList.length === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new QueueDashboardUnguardedError();
    }

    log.warn(
      "queue",
      "dashboard",
      "queue.dashboard.enabled is true with no middleware. The dashboard can retry and delete " +
        "jobs — add a guard middleware before this ships to production.",
    );
  }

  if (!server) {
    log.warn(
      "queue",
      "dashboard",
      "queue.dashboard.enabled is true but no HTTP server was found; the dashboard was not mounted.",
    );

    return;
  }

  await queueDashboard(server, {
    basePath: dashboard.path ?? DEFAULT_DASHBOARD_PATH,
    middleware: middlewareList,
  });
}
