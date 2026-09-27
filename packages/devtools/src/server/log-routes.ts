import type { FastifyInstance } from "fastify";
import type { DevtoolsLogEntry } from "../types";
import type { MountDevtoolsRoutesDeps } from "./types";

type LogsQuery = { level?: DevtoolsLogEntry["level"]; module?: string };

/** Registers the log listing route, filterable by `level` and `module`. */
export function registerLogRoutes(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.get<{ Querystring: LogsQuery }>("/api/logs", async (request) =>
    deps.collector.listLogs({ level: request.query.level, module: request.query.module }),
  );
}
