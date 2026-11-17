import type { ResolvedDevtoolsProductionOptions } from "../options";
import type { DevtoolsStore } from "../store/types";
import { capReportSize } from "./cap-report";
import type { DevtoolsLocalReporter, DevtoolsReportWriter } from "./types";

const HOUSEKEEPING_INTERVAL_MS = 10 * 60_000;
const REPORT_MAX_AGE_MS = 5 * 60_000;
const WARN_EVERY_MS = 60_000;

/**
 * Writes the report every `production.reportIntervalMs`, and every 10
 * minutes prunes: reports unseen for 5 minutes, samples older than
 * `requestRetentionHours`, expired sessions and invites, audit entries older
 * than `auditRetentionDays`. Timers are `unref`ed; a failed write is logged
 * once per minute, never thrown.
 */
export function startReportWriter(input: {
  reporter: DevtoolsLocalReporter;
  store: DevtoolsStore;
  production: ResolvedDevtoolsProductionOptions;
  warn?: (message: string) => void;
}): DevtoolsReportWriter {
  const { reporter, store, production, warn } = input;
  let stopped = false;
  let lastWarnAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<void> = Promise.resolve();

  function fail(what: string, error: unknown): void {
    const now = Date.now();

    if (!warn || now - lastWarnAt < WARN_EVERY_MS) return;

    lastWarnAt = now;

    const reason = error instanceof Error ? error.message : String(error);

    warn(`Devtools could not ${what}: ${reason}. It will try again.`);
  }

  async function write(): Promise<void> {
    if (stopped) return;

    try {
      await store.reports.write(capReportSize(await reporter.snapshot()));
    } catch (error) {
      fail("write this instance's report to the database", error);
    }
  }

  async function housekeeping(): Promise<void> {
    if (stopped) return;

    const now = Date.now();
    const steps: [string, () => Promise<unknown>][] = [
      ["remove old instance reports", () => store.reports.prune(now - REPORT_MAX_AGE_MS)],
      [
        "remove old request samples",
        () => store.samples.prune(now - production.requestRetentionHours * 3_600_000),
      ],
      ["remove expired sessions", () => store.sessions.removeExpired(now)],
      ["remove expired invites", () => store.invites.removeExpired(now)],
      [
        "remove old audit entries",
        () => store.audit.prune(now - production.auditRetentionDays * 86_400_000),
      ],
    ];

    for (const [what, step] of steps) {
      try {
        await step();
      } catch (error) {
        fail(what, error);
      }
    }
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    pending = pending.then(task);

    return pending;
  }

  const writeTimer = setInterval(() => void enqueue(write), production.reportIntervalMs);
  const housekeepingTimer = setInterval(() => void enqueue(housekeeping), HOUSEKEEPING_INTERVAL_MS);

  writeTimer.unref();
  housekeepingTimer.unref();
  void enqueue(write);

  return {
    writeNow: () => enqueue(write),

    async stop() {
      stopped = true;
      clearInterval(writeTimer);
      clearInterval(housekeepingTimer);
      await pending;
    },
  };
}
