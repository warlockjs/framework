import { constants, monitorEventLoopDelay, performance, PerformanceObserver } from "node:perf_hooks";
import v8 from "node:v8";
import type {
  DevtoolsResourcePoint,
  DevtoolsResourceSnapshot,
} from "../contracts";
import type { DevtoolsResourceMonitor } from "./types";

type GcKind = keyof DevtoolsResourceSnapshot["gcByKind"];

/** The readings a monitor takes; replaced by fakes in specs. */
export type DevtoolsResourceSources = {
  now(): number;
  memoryUsage(): { rss: number; heapUsed: number; heapTotal: number; external: number };
  /** Microseconds, as `process.cpuUsage()`. */
  cpuUsage(): { user: number; system: number };
  heapLimit(): number;
  uptime(): number;
  /** Nanoseconds, as a `perf_hooks` interval histogram. */
  eventLoopDelay(): {
    enable(): unknown;
    disable(): unknown;
    reset(): void;
    percentile(percentile: number): number;
    readonly max: number;
  };
  eventLoopUtilization(): { idle: number; active: number };
  /** Calls `onGc` for every collection; returns the function that stops observing. */
  observeGc(onGc: (kind: GcKind, durationMs: number) => void): () => void;
};

function gcKindName(kind: number | undefined): GcKind {
  if (kind === constants.NODE_PERFORMANCE_GC_MAJOR) return "major";
  if (kind === constants.NODE_PERFORMANCE_GC_INCREMENTAL) return "incremental";
  if (kind === constants.NODE_PERFORMANCE_GC_WEAKCB) return "weakcb";

  return "minor";
}

const defaultSources: DevtoolsResourceSources = {
  now: () => Date.now(),
  memoryUsage: () => process.memoryUsage(),
  cpuUsage: () => process.cpuUsage(),
  heapLimit: () => v8.getHeapStatistics().heap_size_limit,
  uptime: () => process.uptime(),
  eventLoopDelay: () => monitorEventLoopDelay({ resolution: 20 }),
  eventLoopUtilization: () => performance.eventLoopUtilization(),
  observeGc(onGc) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const detail = (entry as unknown as { detail?: { kind?: number }; kind?: number }).detail;
        const kind = detail?.kind ?? (entry as unknown as { kind?: number }).kind;

        onGc(gcKindName(kind), entry.duration);
      }
    });

    observer.observe({ entryTypes: ["gc"] });

    return () => observer.disconnect();
  },
};

/** Nanoseconds to milliseconds; a histogram with no samples reports 0. */
function nsToMs(value: number): number {
  return Number.isFinite(value) && value > 0 && value < 1e15 ? value / 1e6 : 0;
}

/** Resource sampling every `intervalMs` (default 5000), `historySize` points (default 120). */
export function createResourceMonitor(
  options: {
    intervalMs?: number;
    historySize?: number;
    sources?: Partial<DevtoolsResourceSources>;
  } = {},
): DevtoolsResourceMonitor {
  const intervalMs = options.intervalMs ?? 5000;
  const historySize = Math.max(1, options.historySize ?? 120);
  const sources: DevtoolsResourceSources = { ...defaultSources, ...options.sources };

  const loopDelay = sources.eventLoopDelay();
  const points: DevtoolsResourcePoint[] = [];
  const gcByKind: DevtoolsResourceSnapshot["gcByKind"] = {
    minor: { count: 0, pauseMs: 0 },
    major: { count: 0, pauseMs: 0 },
    incremental: { count: 0, pauseMs: 0 },
    weakcb: { count: 0, pauseMs: 0 },
  };
  let gcCountSince = 0;
  let gcPauseSince = 0;
  let lastAt = sources.now();
  let lastCpu = sources.cpuUsage();
  let lastElu = sources.eventLoopUtilization();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopGc: (() => void) | undefined;

  function sample(): DevtoolsResourcePoint {
    const at = sources.now();
    const memory = sources.memoryUsage();
    const cpu = sources.cpuUsage();
    const elu = sources.eventLoopUtilization();
    const wallMs = at - lastAt;
    const cpuMs = (cpu.user + cpu.system - lastCpu.user - lastCpu.system) / 1000;
    const active = elu.active - lastElu.active;
    const idle = elu.idle - lastElu.idle;

    const point: DevtoolsResourcePoint = {
      at,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      cpuPercent: wallMs > 0 ? Math.max(0, (cpuMs / wallMs) * 100) : 0,
      eventLoopDelayP50Ms: nsToMs(loopDelay.percentile(50)),
      eventLoopDelayP99Ms: nsToMs(loopDelay.percentile(99)),
      eventLoopDelayMaxMs: nsToMs(loopDelay.max),
      eventLoopUtilization: active + idle > 0 ? active / (active + idle) : 0,
      gcCount: gcCountSince,
      gcPauseMs: gcPauseSince,
    };

    loopDelay.reset();
    lastAt = at;
    lastCpu = cpu;
    lastElu = elu;
    gcCountSince = 0;
    gcPauseSince = 0;

    points.push(point);

    if (points.length > historySize) points.splice(0, points.length - historySize);

    return { ...point };
  }

  return {
    start() {
      if (timer) return;

      lastAt = sources.now();
      lastCpu = sources.cpuUsage();
      lastElu = sources.eventLoopUtilization();
      loopDelay.enable();
      stopGc = sources.observeGc((kind, durationMs) => {
        gcCountSince++;
        gcPauseSince += durationMs;
        gcByKind[kind].count++;
        gcByKind[kind].pauseMs += durationMs;
      });
      timer = setInterval(sample, intervalMs);
      timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);

      timer = undefined;
      stopGc?.();
      stopGc = undefined;
      loopDelay.disable();
    },

    sample,

    snapshot() {
      const latest = points[points.length - 1] ?? sample();

      return {
        ...latest,
        heapLimitBytes: sources.heapLimit(),
        uptimeSeconds: sources.uptime(),
        gcByKind: structuredClone(gcByKind),
      };
    },

    history() {
      return points.map((point) => ({ ...point }));
    },
  };
}
