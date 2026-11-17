import type { FastifyInstance } from "fastify";
import type { DevtoolsLogRow } from "../production/contracts";
import type { DevtoolsLogEntry } from "../types";
import { parseInsightQuery } from "./insights-routes";
import type { MountDevtoolsRoutesDeps } from "./types";

type LogsQuery = {
  level?: DevtoolsLogEntry["level"];
  module?: string;
  instance?: string;
  limit?: string;
};

/**
 * Registers the log listing route, filterable by `level` and `module`. It
 * answers from the insights (every instance in production) when they are
 * mounted, else from the collector's logs.
 */
export function registerLogRoutes(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.get<{ Querystring: LogsQuery }>("/api/logs", async (request, reply) => {
    const { level, module } = request.query;

    if (deps.insights) {
      const query = parseInsightQuery(request.query);

      reply.header("Cache-Control", "no-store");

      return deps.insights.logs({
        ...query,
        ...(level ? { level } : {}),
        ...(module ? { module } : {}),
      });
    }

    const rows: DevtoolsLogRow[] = deps.collector.listLogs({ level, module }).map((entry) => ({
      level: entry.level,
      module: entry.module,
      action: entry.action,
      message: entry.message,
      at: entry.at,
      requestId: null,
      instance: null,
      context: entry.context,
    }));

    return rows;
  });
}
