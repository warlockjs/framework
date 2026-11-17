import { createCollector } from "../../collector";
import { queryShape } from "../../query-shape";
import type {
  DevtoolsCacheOperation,
  DevtoolsCollector,
  DevtoolsLogEntry,
  DevtoolsQuery,
  DevtoolsRequest,
} from "../../types";
import type { DevtoolsCaptureCounters, DevtoolsSampleDetail, DevtoolsSampleSummary } from "../contracts";
import type { DevtoolsStoredSample } from "../store/types";
import { createShapeExplainer } from "./explain";
import { sampleMatchesFilter } from "./filter";
import { scrubErrorText, scrubQueryError, toStoredSample } from "./redact";
import {
  createErrorGroups,
  createQueryStats,
  createRecentLogs,
  createRouteStats,
  truncate,
} from "./stats-stores";
import type {
  DevtoolsCaptureDeps,
  DevtoolsErrorGroups,
  DevtoolsQueryStats,
  DevtoolsRecentLogs,
  DevtoolsRequestSource,
  DevtoolsRouteStatsStore,
} from "./types";

/** Per sampled request limits (see "Bounded memory"). */
const MAX_LOGS_PER_REQUEST = 50;
const MAX_PHASES_PER_REQUEST = 100;
const MAX_CACHE_PER_REQUEST = 1000;
const MAX_ACTIVE = 2000;
const MAX_PENDING = 500;
const FLUSH_AT = 50;
const FLUSH_EVERY_MS = 5000;
const WARN_EVERY_MS = 60_000;
const LOG_MESSAGE_MAX = 1000;

/** The shape of the event cascade's `dataSourceRegistry` emits for `"query"`. */
export type DevtoolsQueryEvent = {
  connection: string;
  driver: "postgres" | "mongodb";
  sql?: string;
  bindings?: unknown[];
  collection?: string;
  command?: string;
  pipeline?: unknown;
  durationMs: number;
  startedAt: number;
  rowCount?: number;
  error?: unknown;
};

/** What core's tracing hooks hand over for a request. */
export type DevtoolsTracedRequest = {
  requestId: string;
  method: string;
  path: string;
  route?: string | undefined;
};

type RequestState = {
  queries: number;
  logs: number;
  phases: number;
  cache: number;
  dropped: number;
  route: string | undefined;
};

/** The functions the tracing, query, log and cache sources call. */
export type DevtoolsCaptureHooks = {
  onRequestStart(request: DevtoolsTracedRequest): void;
  onPhase(
    request: DevtoolsTracedRequest,
    phase: { name: string; durationMs: number; startedAt?: number | undefined },
  ): void;
  onRequestEnd(
    request: DevtoolsTracedRequest,
    result: { status?: number | undefined; durationMs: number; error?: unknown },
  ): void;
  onQuery(requestId: string | undefined, event: DevtoolsQueryEvent): void;
  onLog(requestId: string | undefined, entry: Omit<DevtoolsLogEntry, "context">): void;
  onCache(requestId: string | undefined, operation: DevtoolsCacheOperation): void;
};

/** Everything the production capture is made of, apart from the registration with core, cascade, the logger and the cache. */
export type DevtoolsCaptureEngine = {
  collector: DevtoolsCollector;
  queries: DevtoolsQueryStats;
  routes: DevtoolsRouteStatsStore;
  errors: DevtoolsErrorGroups;
  logs: DevtoolsRecentLogs;
  requests: DevtoolsRequestSource;
  hooks: DevtoolsCaptureHooks;
  counters(): DevtoolsCaptureCounters;
  explain(shapeId: string): ReturnType<ReturnType<typeof createShapeExplainer>>;
  /** Starts the 5 s write timer (a no-op without a store). */
  startWriter(): void;
  stopWriter(): void;
  flush(): Promise<void>;
};

function stripQuery(path: string): string {
  const index = path.indexOf("?");

  return index === -1 ? path : path.slice(0, index);
}

/** The lengths the error groups keep (see `createErrorGroups`). */
const REQUEST_ERROR_MAX = 500;
const REQUEST_STACK_MAX = 4000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A request's error message as the monitor keeps it: without the values in it (see `scrubErrorText`). */
function requestErrorMessage(error: unknown): string {
  return scrubErrorText(errorMessage(error), REQUEST_ERROR_MAX);
}

function touchesMonitorTables(event: DevtoolsQueryEvent): boolean {
  return (
    (event.sql !== undefined && event.sql.includes("devtools_")) ||
    (event.collection !== undefined && event.collection.startsWith("devtools_"))
  );
}

/**
 * The capture of one process without any registration: sampling, the ring,
 * the statistics, the sample writer and the request source. The hooks are
 * plain functions so a spec (or the benchmark) can drive them directly.
 */
export function createCaptureEngine(deps: DevtoolsCaptureDeps): DevtoolsCaptureEngine {
  const { production, instance, store } = deps;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => performance.timeOrigin + performance.now());
  const warn = deps.warn ?? (() => {});
  const logLevels = new Set<string>(production.logLevels);

  const collector = createCollector({ ...deps.options, maxRequests: production.maxRequests });
  const queries = createQueryStats({ maxShapes: production.maxShapes, instance: instance.id });
  const routes = createRouteStats({ maxRoutes: production.maxRoutes, instance: instance.id });
  const errors = createErrorGroups({ maxGroups: production.maxErrorGroups });
  const logs = createRecentLogs({ maxEntries: 200 });

  const active = new Map<string, RequestState>();
  const recent = new Map<string, DevtoolsStoredSample>();
  const pending: DevtoolsStoredSample[] = [];
  const counts = {
    requests: 0,
    sampled: 0,
    keptUnsampled: 0,
    stored: 0,
    droppedStored: 0,
    droppedQueries: 0,
  };

  let exampleSequence = 0;
  let budgetMinute = -1;
  let budgetUsed = 0;
  let lastWarnAt = -Infinity;
  let flushing: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;

  // -- sample writer ---------------------------------------------------------

  const remember = (sample: DevtoolsStoredSample) => {
    recent.delete(sample.id);
    recent.set(sample.id, sample);

    while (recent.size > production.maxRequests) {
      recent.delete(recent.keys().next().value as string);
    }
  };

  const doFlush = async () => {
    if (!store || pending.length === 0) return;

    const batch = pending.splice(0, pending.length);

    try {
      await store.samples.insert(batch);
      counts.stored += batch.length;
    } catch (error) {
      counts.droppedStored += batch.length;

      const at = now();

      if (at - lastWarnAt >= WARN_EVERY_MS) {
        lastWarnAt = at;
        warn(
          `devtools could not store ${batch.length} request sample(s), they were dropped: ${errorMessage(error)}. Check the database connection and that the devtools migrations ran.`,
        );
      }
    }
  };

  const flush = (): Promise<void> => {
    flushing = flushing.then(doFlush, doFlush);

    return flushing;
  };

  const enqueue = (sample: DevtoolsStoredSample) => {
    remember(sample);

    if (!store) return;

    const minute = Math.floor(now() / 60_000);

    if (minute !== budgetMinute) {
      budgetMinute = minute;
      budgetUsed = 0;
    }

    if (budgetUsed >= production.maxStoredSamplesPerMinute) {
      counts.droppedStored++;
      return;
    }

    budgetUsed++;
    pending.push(sample);

    if (pending.length > MAX_PENDING) {
      pending.shift();
      counts.droppedStored++;
    }

    if (pending.length >= FLUSH_AT) void flush();
  };

  // -- hooks -----------------------------------------------------------------

  const newState = (route: string | undefined): RequestState => ({
    queries: 0,
    logs: 0,
    phases: 0,
    cache: 0,
    dropped: 0,
    route,
  });

  const recordRequestError = (
    request: DevtoolsTracedRequest,
    result: { status?: number | undefined; error?: unknown },
    route: string | undefined,
  ) => {
    const status = result.status;
    const failed = (status !== undefined && status >= 500) || result.error !== undefined;

    if (!failed) return;

    const error = result.error;

    errors.record({
      source: "request",
      message: error === undefined ? `HTTP ${status}` : requestErrorMessage(error),
      name: error instanceof Error ? error.name : null,
      // The first line of a stack repeats the message.
      stack:
        error instanceof Error && error.stack !== undefined
          ? scrubErrorText(error.stack, REQUEST_STACK_MAX)
          : null,
      route: route ?? null,
      status: status ?? null,
      requestId: request.requestId,
      at: now(),
    });
  };

  const finishSampled = (
    request: DevtoolsTracedRequest,
    state: RequestState,
    result: { status?: number | undefined; durationMs: number; error?: unknown },
  ) => {
    const route = request.route ?? state.route;

    collector.endRequest(request.requestId, {
      ...(result.status === undefined ? {} : { status: result.status }),
      durationMs: result.durationMs,
      ...(result.error === undefined ? {} : { error: requestErrorMessage(result.error) }),
      ...(route === undefined ? {} : { route }),
    });

    const settled = collector.getRequest(request.requestId);

    if (!settled) return;

    const failed =
      (result.status !== undefined && result.status >= 500) || result.error !== undefined;

    routes.record({
      method: request.method,
      route: route ?? "",
      status: result.status ?? null,
      failed,
      durationMs: result.durationMs,
      at: now(),
      requestId: request.requestId,
      phases: settled.phases.map((phase) => ({ name: phase.name, durationMs: phase.durationMs })),
    });

    for (const warning of settled.warnings) queries.recordNPlusOne(warning.shape, warning.count);

    recordRequestError(request, result, route);
    enqueue(toStoredSample(settled, instance.id, state.dropped));
  };

  const finishUnsampled = (
    request: DevtoolsTracedRequest,
    result: { status?: number | undefined; durationMs: number; error?: unknown },
  ) => {
    if (deps.isDashboardPath(request.path)) return;

    counts.keptUnsampled++;

    const startedAt = now() - result.durationMs;
    const path = stripQuery(request.path);
    const summary: DevtoolsSampleSummary = {
      id: request.requestId,
      method: request.method,
      path,
      startedAt,
      durationMs: result.durationMs,
      queryCount: 0,
      warningCount: 0,
      instance: instance.id,
      partial: true,
    };

    if (request.route !== undefined) summary.route = request.route;
    if (result.status !== undefined) summary.status = result.status;

    recordRequestError(request, result, request.route);
    enqueue({ id: request.requestId, instance: instance.id, startedAt, summary, detail: null });

    // The live stream shows it too.
    collector.startRequest({
      id: request.requestId,
      method: request.method,
      path,
      ...(request.route === undefined ? {} : { route: request.route }),
      startedAt,
    });
    collector.endRequest(request.requestId, {
      ...(result.status === undefined ? {} : { status: result.status }),
      durationMs: result.durationMs,
      ...(result.error === undefined ? {} : { error: requestErrorMessage(result.error) }),
      ...(request.route === undefined ? {} : { route: request.route }),
    });
  };

  /** The query without an id or a shape, from what the driver emitted. */
  const queryInput = (event: DevtoolsQueryEvent): Omit<DevtoolsQuery, "id" | "shape"> => {
    const input: Omit<DevtoolsQuery, "id" | "shape"> = {
      connection: event.connection,
      driver: event.driver,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
    };

    if (event.sql !== undefined) input.sql = event.sql;
    if (event.bindings !== undefined) input.bindings = event.bindings;
    if (event.collection !== undefined) input.collection = event.collection;
    if (event.command !== undefined) input.command = event.command;
    if (event.pipeline !== undefined) input.pipeline = event.pipeline;
    if (event.rowCount !== undefined) input.rowCount = event.rowCount;
    if (event.error !== undefined) input.error = scrubQueryError(errorMessage(event.error));

    return input;
  };

  const exampleOf = (event: DevtoolsQueryEvent): DevtoolsQuery => ({
    ...queryInput(event),
    id: `x${++exampleSequence}`,
    shape: queryShape(event),
  });

  const recordQuery = (
    query: DevtoolsQuery,
    route: string | null,
    requestId: string | null,
  ) => {
    queries.record({
      shape: query.shape,
      driver: query.driver,
      connection: query.connection,
      durationMs: query.durationMs,
      failed: query.error !== undefined,
      at: query.startedAt,
      route,
      requestId,
    });
    queries.rememberExample(query);
  };

  const hooks: DevtoolsCaptureHooks = {
    onRequestStart(request) {
      if (deps.isDashboardPath(request.path)) return;

      counts.requests++;

      if (!(random() < production.sampleRate)) return;

      counts.sampled++;

      if (active.size >= MAX_ACTIVE) active.delete(active.keys().next().value as string);

      active.set(request.requestId, newState(request.route));
      collector.startRequest({
        id: request.requestId,
        method: request.method,
        path: stripQuery(request.path),
        ...(request.route === undefined ? {} : { route: request.route }),
        startedAt: now(),
      });
    },

    onPhase(request, phase) {
      const state = active.get(request.requestId);

      if (!state) return;

      if (request.route !== undefined) state.route = request.route;
      if (state.phases >= MAX_PHASES_PER_REQUEST) return;

      state.phases++;
      collector.addPhase(request.requestId, {
        name: phase.name,
        durationMs: phase.durationMs,
        startedAt: phase.startedAt ?? now() - phase.durationMs,
      });
    },

    onRequestEnd(request, result) {
      const state = active.get(request.requestId);

      if (state) {
        active.delete(request.requestId);
        finishSampled(request, state, result);
        return;
      }

      if (
        result.durationMs >= production.slowRequestMs ||
        (result.status !== undefined && result.status >= 500) ||
        result.error !== undefined
      ) {
        finishUnsampled(request, result);
      }
    },

    onQuery(requestId, event) {
      const state = requestId === undefined ? undefined : active.get(requestId);

      if (state && requestId !== undefined) {
        if (touchesMonitorTables(event)) return;

        let query: DevtoolsQuery;

        if (state.queries < production.maxQueriesPerRequest) {
          state.queries++;
          query = collector.addQuery(requestId, queryInput(event));
        } else {
          state.dropped++;
          counts.droppedQueries++;
          query = exampleOf(event);
        }

        recordQuery(query, state.route ?? null, requestId);

        // The ring keeps the shape only; the statistics copied what EXPLAIN needs.
        delete query.sql;
        delete query.bindings;
        delete query.pipeline;
        return;
      }

      if (requestId === undefined) {
        // Work outside a request is sampled query by query.
        if (touchesMonitorTables(event)) return;

        if (random() < production.sampleRate) {
          const query = exampleOf(event);

          recordQuery(query, null, null);
        } else if (event.durationMs >= production.slowQueryMs) {
          queries.rememberExample(exampleOf(event));
        }

        return;
      }

      // An unsampled request: only a slow query leaves a trace, in its shape's `slowest`.
      if (event.durationMs >= production.slowQueryMs && !touchesMonitorTables(event)) {
        queries.rememberExample(exampleOf(event));
      }
    },

    onLog(requestId, entry) {
      const wanted = logLevels.has(entry.level);
      const state = requestId === undefined ? undefined : active.get(requestId);

      if (!wanted && !state) return;

      const message = truncate(entry.message, LOG_MESSAGE_MAX);
      const kept: DevtoolsLogEntry = {
        level: entry.level,
        module: entry.module,
        action: entry.action,
        message,
        at: entry.at,
      };

      if (state && requestId !== undefined) {
        if (state.logs < MAX_LOGS_PER_REQUEST) {
          state.logs++;
          collector.addLog(requestId, kept);
        }
      } else {
        collector.addLog(undefined, kept);
      }

      if (!wanted) return;

      logs.record({
        level: entry.level,
        module: entry.module,
        action: entry.action,
        message,
        at: entry.at,
        requestId: state && requestId !== undefined ? requestId : null,
      });

      if (entry.level === "error") {
        errors.record({
          source: "log",
          message: entry.message,
          name: null,
          stack: null,
          route: state?.route ?? null,
          status: null,
          requestId: state && requestId !== undefined ? requestId : null,
          at: entry.at,
        });
      }
    },

    onCache(requestId, operation) {
      if (requestId === undefined) return;

      const state = active.get(requestId);

      if (!state || state.cache >= MAX_CACHE_PER_REQUEST) return;

      state.cache++;
      // Counts only: keys and tags never enter the ring.
      collector.addCacheOperation(requestId, {
        type: operation.type,
        driver: operation.driver,
        at: operation.at,
      });
    },
  };

  // -- request source --------------------------------------------------------

  const requests: DevtoolsRequestSource = {
    async list(filter) {
      let storedRows: DevtoolsSampleSummary[] = [];

      if (store) {
        try {
          storedRows = await store.samples.list(filter);
        } catch (error) {
          warn(
            `devtools could not read request samples: ${errorMessage(error)}. Showing this process's requests only.`,
          );
        }
      }

      const merged = new Map<string, DevtoolsSampleSummary>();

      for (const row of storedRows) merged.set(row.id, row);

      for (const sample of recent.values()) {
        if (!merged.has(sample.id) && sampleMatchesFilter(sample.summary, filter)) {
          merged.set(sample.id, sample.summary);
        }
      }

      return [...merged.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, Math.max(1, filter.limit));
    },

    async get(id) {
      let stored: DevtoolsStoredSample | null = null;

      if (store) {
        try {
          stored = await store.samples.get(id);
        } catch {
          stored = null;
        }
      }

      stored ??= recent.get(id) ?? null;

      if (stored) return stored.detail ?? stored.summary;

      const live: DevtoolsRequest | undefined = collector.getRequest(id);

      if (!live) return null;

      const dropped = active.get(id)?.dropped ?? 0;
      const sample = toStoredSample(live, instance.id, dropped);

      return (sample.detail ?? sample.summary) as DevtoolsSampleDetail | DevtoolsSampleSummary;
    },

    async clear() {
      const memory = recent.size;
      const waiting = pending.length;

      recent.clear();
      pending.length = 0;
      collector.clear();

      if (!store) return memory;

      const removed = await store.samples.clear();

      return removed + waiting;
    },
  };

  const explain = createShapeExplainer({
    queries,
    executing: production.explain.executing,
    instance: instance.id,
    ...(deps.run === undefined ? {} : { run: deps.run }),
  });

  return {
    collector,
    queries,
    routes,
    errors,
    logs,
    requests,
    hooks,
    explain,
    flush,
    counters: () => ({
      sampleRate: production.sampleRate,
      requests: counts.requests,
      sampled: counts.sampled,
      keptUnsampled: counts.keptUnsampled,
      stored: counts.stored,
      droppedStored: counts.droppedStored,
      evictedShapes: queries.evicted(),
      evictedRoutes: routes.evicted(),
      evictedErrors: errors.evicted(),
      droppedQueries: counts.droppedQueries,
    }),
    startWriter() {
      if (!store || timer) return;

      timer = setInterval(() => void flush(), FLUSH_EVERY_MS);
      timer.unref();
    },
    stopWriter() {
      if (timer) clearInterval(timer);

      timer = undefined;
    },
  };
}
