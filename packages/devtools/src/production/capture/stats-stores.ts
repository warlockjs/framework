import type {
  DevtoolsErrorGroup,
  DevtoolsHistogram,
  DevtoolsQueryShapeStats,
  DevtoolsReportLogEntry,
  DevtoolsRoutePhaseStats,
  DevtoolsRouteStats,
} from "../contracts";
import { createHistogram, recordDuration, shortId } from "../stats";
import type { DevtoolsQuery } from "../../types";
import type {
  DevtoolsErrorGroups,
  DevtoolsQueryObservation,
  DevtoolsQueryStats,
  DevtoolsRecentLogs,
  DevtoolsRequestObservation,
  DevtoolsRouteStatsStore,
} from "./types";

const SHAPE_MAX = 2000;
const MESSAGE_MAX = 500;
const STACK_MAX = 4000;
const LOG_MESSAGE_MAX = 1000;
const PHASES_PER_ROUTE = 30;

const MONGO_EXPLAINABLE = new Set(["find", "aggregate", "count"]);
const SQL_START = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(select|with)\b/i;

/** Whether a normalized query shape can be explained (a Postgres `SELECT`/`WITH`, or a MongoDB `find`/`aggregate`/`count`). */
export function isExplainableShape(driver: "postgres" | "mongodb", shape: string): boolean {
  if (driver === "postgres") return SQL_START.test(shape);

  // MongoDB shapes read `<collection>.<command> <json>`; the collection may hold dots.
  const space = shape.indexOf(" ");
  const head = space === -1 ? shape : shape.slice(0, space);
  const command = head.slice(head.lastIndexOf(".") + 1);

  return MONGO_EXPLAINABLE.has(command);
}

const shapeIds = new Map<string, string>();
const SHAPE_ID_CACHE = 2000;

/** `shortId` of a query shape, remembered: the same few hundred shapes arrive over and over. */
export function shapeIdOf(shape: string): string {
  let id = shapeIds.get(shape);

  if (id === undefined) {
    if (shapeIds.size >= SHAPE_ID_CACHE) shapeIds.clear();

    id = shortId(shape);
    shapeIds.set(shape, id);
  }

  return id;
}

export function truncate(value: string, maximum: number): string {
  return value.length > maximum ? value.slice(0, maximum) : value;
}

function copyHistogram(histogram: DevtoolsHistogram): DevtoolsHistogram {
  return { ...histogram, counts: [...histogram.counts] };
}

// ---------------------------------------------------------------------------
// Query statistics
// ---------------------------------------------------------------------------

type QueryEntry = {
  stats: DevtoolsQueryShapeStats;
  example: DevtoolsQuery | undefined;
};

/** Bounded per-shape query statistics. */
export function createQueryStats(limits: {
  maxShapes: number;
  instance: string;
}): DevtoolsQueryStats {
  // Insertion order is recency: a touched entry moves to the end.
  const entries = new Map<string, QueryEntry>();
  let evictedCount = 0;

  const touch = (
    shape: string,
    driver: "postgres" | "mongodb",
    connection: string,
    at: number,
  ): QueryEntry => {
    const id = shapeIdOf(shape);
    let entry = entries.get(id);

    if (entry) {
      entries.delete(id);
      entry.stats.lastSeen = Math.max(entry.stats.lastSeen, at);
    } else {
      entry = {
        example: undefined,
        stats: {
          id,
          shape: truncate(shape, SHAPE_MAX),
          driver,
          connection,
          count: 0,
          errors: 0,
          histogram: createHistogram(),
          nPlusOne: { requests: 0, maxPerRequest: 0 },
          slowest: null,
          firstSeen: at,
          lastSeen: at,
          explainable: isExplainableShape(driver, shape),
        },
      };
    }

    entries.set(id, entry);

    while (entries.size > limits.maxShapes) {
      const oldest = entries.keys().next().value as string;

      entries.delete(oldest);
      evictedCount++;
    }

    return entry;
  };

  return {
    record(query: DevtoolsQueryObservation) {
      const entry = touch(query.shape, query.driver, query.connection, query.at);

      entry.stats.count++;
      if (query.failed) entry.stats.errors++;
      recordDuration(entry.stats.histogram, query.durationMs);

      const slowest = entry.stats.slowest;

      if (!slowest || query.durationMs > slowest.durationMs) {
        entry.stats.slowest = {
          durationMs: query.durationMs,
          at: query.at,
          route: query.route,
          requestId: query.requestId,
          instance: limits.instance,
        };
      }
    },
    recordNPlusOne(shape, count) {
      const known = entries.get(shapeIdOf(shape))?.stats;
      const entry = touch(shape, known?.driver ?? "postgres", known?.connection ?? "", Date.now());

      entry.stats.nPlusOne.requests++;
      if (count > entry.stats.nPlusOne.maxPerRequest) entry.stats.nPlusOne.maxPerRequest = count;
    },
    rememberExample(query) {
      const entry = touch(query.shape, query.driver, query.connection, query.startedAt);

      if (!entry.example || query.durationMs > entry.example.durationMs) {
        // A copy: the caller may strip the original, and the bindings array is the caller's.
        entry.example = {
          ...query,
          ...(query.bindings === undefined ? {} : { bindings: [...query.bindings] }),
        };
      }

      const slowest = entry.stats.slowest;

      if (!slowest || query.durationMs > slowest.durationMs) {
        entry.stats.slowest = {
          durationMs: query.durationMs,
          at: query.startedAt,
          route: null,
          requestId: null,
          instance: limits.instance,
        };
      }
    },
    example(shapeId) {
      return entries.get(shapeId)?.example;
    },
    snapshot(limit) {
      return [...entries.values()]
        .map(({ stats }) => stats)
        .sort((a, b) => b.histogram.sumMs - a.histogram.sumMs)
        .slice(0, Math.max(0, limit))
        .map((stats) => ({
          ...stats,
          histogram: copyHistogram(stats.histogram),
          nPlusOne: { ...stats.nPlusOne },
          slowest: stats.slowest ? { ...stats.slowest } : null,
        }));
    },
    evicted: () => evictedCount,
    clear() {
      entries.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Route statistics
// ---------------------------------------------------------------------------

type RouteEntry = {
  stats: DevtoolsRouteStats;
  phases: Map<string, DevtoolsRoutePhaseStats>;
};

/** Bounded per-route statistics. */
export function createRouteStats(limits: {
  maxRoutes: number;
  instance: string;
}): DevtoolsRouteStatsStore {
  const entries = new Map<string, RouteEntry>();
  let evictedCount = 0;

  return {
    record(request: DevtoolsRequestObservation) {
      const route = request.route === "" ? "(unmatched)" : request.route;
      const key = `${request.method} ${route}`;
      let entry = entries.get(key);

      if (entry) {
        entries.delete(key);
      } else {
        entry = {
          phases: new Map(),
          stats: {
            key,
            method: request.method,
            route,
            count: 0,
            errors: 0,
            histogram: createHistogram(),
            phases: [],
            slowest: null,
          },
        };
      }

      entries.set(key, entry);

      while (entries.size > limits.maxRoutes) {
        entries.delete(entries.keys().next().value as string);
        evictedCount++;
      }

      entry.stats.count++;
      if (request.failed) entry.stats.errors++;
      recordDuration(entry.stats.histogram, request.durationMs);

      const slowest = entry.stats.slowest;

      if (!slowest || request.durationMs > slowest.durationMs) {
        entry.stats.slowest = {
          durationMs: request.durationMs,
          at: request.at,
          requestId: request.requestId,
          instance: limits.instance,
        };
      }

      for (const phase of request.phases) {
        let stats = entry.phases.get(phase.name);

        if (!stats) {
          if (entry.phases.size >= PHASES_PER_ROUTE) {
            // Make room by dropping the phase with the smallest total.
            let smallest: string | undefined;

            for (const [name, candidate] of entry.phases) {
              if (smallest === undefined || candidate.sumMs < (entry.phases.get(smallest)?.sumMs ?? 0)) {
                smallest = name;
              }
            }

            if (smallest !== undefined) entry.phases.delete(smallest);
          }

          stats = { name: phase.name, count: 0, sumMs: 0, maxMs: 0 };
          entry.phases.set(phase.name, stats);
        }

        const duration = Number.isFinite(phase.durationMs) ? Math.max(0, phase.durationMs) : 0;

        stats.count++;
        stats.sumMs += duration;
        if (duration > stats.maxMs) stats.maxMs = duration;
      }
    },
    snapshot(limit) {
      return [...entries.values()]
        .sort((a, b) => b.stats.histogram.sumMs - a.stats.histogram.sumMs)
        .slice(0, Math.max(0, limit))
        .map(({ stats, phases }) => ({
          ...stats,
          histogram: copyHistogram(stats.histogram),
          slowest: stats.slowest ? { ...stats.slowest } : null,
          phases: [...phases.values()]
            .sort((a, b) => b.sumMs - a.sumMs)
            .slice(0, PHASES_PER_ROUTE)
            .map((phase) => ({ ...phase })),
        }));
    },
    evicted: () => evictedCount,
    clear() {
      entries.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Error groups
// ---------------------------------------------------------------------------

const QUOTED = /'(?:''|[^'])*'|"(?:\\.|[^"\\])*"/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const HEX_ID = /\b0x[0-9a-f]+\b|\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi;
const NUMBER = /\d+(?:\.\d+)?/g;

/**
 * Replaces the parts of an error message that change between occurrences
 * (quoted strings, emails, UUIDs, hex ids, numbers) so equal errors group.
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(QUOTED, "<str>")
    .replace(UUID, "<uuid>")
    .replace(EMAIL, "<email>")
    .replace(HEX_ID, "<hex>")
    .replace(NUMBER, "<n>");
}

/** Bounded error groups. */
export function createErrorGroups(limits: { maxGroups: number }): DevtoolsErrorGroups {
  const groups = new Map<string, DevtoolsErrorGroup>();
  let evictedCount = 0;

  return {
    record(input) {
      const id = shortId(
        `${input.source}\n${input.name ?? ""}\n${normalizeErrorMessage(input.message)}\n${input.route ?? ""}`,
      );
      const known = groups.get(id);
      const message = truncate(input.message, MESSAGE_MAX);
      const stack = input.stack === null ? null : truncate(input.stack, STACK_MAX);

      if (known) {
        groups.delete(id);
        known.count++;
        known.message = message;
        known.lastSeen = Math.max(known.lastSeen, input.at);
        known.lastRequestId = input.requestId;
        known.status = input.status ?? known.status;
        if (stack !== null) known.stack = stack;
        groups.set(id, known);
      } else {
        groups.set(id, {
          id,
          message,
          name: input.name,
          source: input.source,
          route: input.route,
          status: input.status,
          count: 1,
          firstSeen: input.at,
          lastSeen: input.at,
          lastRequestId: input.requestId,
          stack,
        });
      }

      while (groups.size > limits.maxGroups) {
        groups.delete(groups.keys().next().value as string);
        evictedCount++;
      }
    },
    snapshot(limit) {
      return [...groups.values()]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, Math.max(0, limit))
        .map((group) => ({ ...group }));
    },
    evicted: () => evictedCount,
    clear() {
      groups.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Recent logs
// ---------------------------------------------------------------------------

/** Recent warn/error log entries, bounded. */
export function createRecentLogs(limits: { maxEntries: number }): DevtoolsRecentLogs {
  // Oldest first internally; read newest first.
  const entries: DevtoolsReportLogEntry[] = [];

  return {
    record(entry) {
      entries.push({ ...entry, message: truncate(entry.message, LOG_MESSAGE_MAX) });

      while (entries.length > limits.maxEntries) entries.shift();
    },
    snapshot(limit, filter = {}) {
      const module = filter.module?.toLowerCase();
      const result: DevtoolsReportLogEntry[] = [];

      for (let index = entries.length - 1; index >= 0 && result.length < limit; index--) {
        const entry = entries[index] as DevtoolsReportLogEntry;

        if (filter.level && entry.level !== filter.level) continue;
        if (module && !entry.module.toLowerCase().includes(module)) continue;

        result.push({ ...entry });
      }

      return result;
    },
    clear() {
      entries.length = 0;
    },
  };
}
