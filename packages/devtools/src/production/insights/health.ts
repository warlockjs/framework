import type { DevtoolsHealthReport } from "../contracts";
import type { DevtoolsHealthStatusReader } from "./readiness";
import type { DevtoolsHealthHistory } from "./types";

/** Core's readiness, imported on first use so devtools never loads core at import time. */
const coreReadiness: DevtoolsHealthStatusReader = async () => {
  const { health } = await import("@warlock.js/core");

  return health.readiness();
};

/** Readiness checks every `intervalMs` (default 30000), 60 history entries. */
export function createHealthHistory(
  options: { intervalMs?: number; size?: number; readiness?: DevtoolsHealthStatusReader } = {},
): DevtoolsHealthHistory {
  const intervalMs = options.intervalMs ?? 30_000;
  const size = Math.max(1, options.size ?? 60);
  const readiness = options.readiness ?? coreReadiness;

  let status: DevtoolsHealthReport["status"] = "unknown";
  let checkedAt: number | null = null;
  let checks: Record<string, boolean> = {};
  const history: DevtoolsHealthReport["history"] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<DevtoolsHealthReport> | undefined;

  function report(): DevtoolsHealthReport {
    return { status, checkedAt, checks: { ...checks }, history: history.map((e) => ({ ...e, failed: [...e.failed] })) };
  }

  async function run(): Promise<DevtoolsHealthReport> {
    try {
      const result = await readiness();
      const now = Date.now();
      const failed = Object.entries(result.checks ?? {})
        .filter(([, passed]) => !passed)
        .map(([name]) => name);

      status = result.status;
      checkedAt = now;
      checks = { ...(result.checks ?? {}) };
      history.push({ at: now, status: result.status, failed });

      if (history.length > size) history.splice(0, history.length - size);
    } catch {
      // Readiness could not be read (core not loaded yet): keep the last answer.
      if (checkedAt === null) status = "unknown";
    }

    return report();
  }

  function check(): Promise<DevtoolsHealthReport> {
    running ??= run().finally(() => {
      running = undefined;
    });

    return running;
  }

  return {
    start() {
      if (timer) return;

      void check();
      timer = setInterval(() => void check(), intervalMs);
      timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);

      timer = undefined;
    },

    check,
    report,
  };
}
