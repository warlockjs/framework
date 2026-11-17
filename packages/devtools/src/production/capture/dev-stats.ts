import { detectNPlusOne } from "../../n-plus-one";
import type { DevtoolsCollector, DevtoolsDisposer, DevtoolsRequest } from "../../types";
import type {
  DevtoolsErrorGroups,
  DevtoolsQueryStats,
  DevtoolsRecentLogs,
  DevtoolsRouteStatsStore,
} from "./types";

/**
 * Development: feeds the statistics from the development collector's settled
 * requests (every request, no sampling), so the Queries, Routes and Errors
 * tabs work in `warlock dev` too.
 */
export function attachDevelopmentStats(
  collector: DevtoolsCollector,
  parts: {
    queries: DevtoolsQueryStats;
    routes: DevtoolsRouteStatsStore;
    errors: DevtoolsErrorGroups;
    logs: DevtoolsRecentLogs;
    nPlusOneThreshold: number;
  },
): DevtoolsDisposer {
  const feed = (request: DevtoolsRequest) => {
    const failed =
      (request.status !== undefined && request.status >= 500) || request.error !== undefined;
    const route = request.route ?? null;

    for (const query of request.queries) {
      parts.queries.record({
        shape: query.shape,
        driver: query.driver,
        connection: query.connection,
        durationMs: query.durationMs,
        failed: query.error !== undefined,
        at: query.startedAt,
        route,
        requestId: request.id,
      });
      parts.queries.rememberExample(query);
    }

    for (const warning of detectNPlusOne(request.queries, parts.nPlusOneThreshold)) {
      parts.queries.recordNPlusOne(warning.shape, warning.count);
    }

    parts.routes.record({
      method: request.method,
      route: request.route ?? "",
      status: request.status ?? null,
      failed,
      durationMs: request.durationMs ?? 0,
      at: request.startedAt,
      requestId: request.id,
      phases: request.phases.map((phase) => ({ name: phase.name, durationMs: phase.durationMs })),
    });

    if (failed) {
      parts.errors.record({
        source: "request",
        message: request.error ?? `HTTP ${request.status}`,
        name: null,
        stack: null,
        route,
        status: request.status ?? null,
        requestId: request.id,
        at: request.startedAt,
      });
    }
  };

  return collector.subscribe((event) => {
    if (event.type === "request") {
      const request = collector.getRequest(event.data.id);

      if (request) feed(request);
      return;
    }

    if (event.type !== "log") return;

    const entry = event.data;

    if (entry.level !== "warn" && entry.level !== "error") return;

    parts.logs.record({
      level: entry.level,
      module: entry.module,
      action: entry.action,
      message: entry.message,
      at: entry.at,
      requestId: null,
    });

    if (entry.level === "error") {
      parts.errors.record({
        source: "log",
        message: entry.message,
        name: null,
        stack: null,
        route: null,
        status: null,
        requestId: null,
        at: entry.at,
      });
    }
  });
}
