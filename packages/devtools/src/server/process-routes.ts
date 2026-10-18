import type { FastifyInstance } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

export function registerProcessRoutes(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  server.get("/api/processes", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return deps.processPanel ? await deps.processPanel.list() : [];
  });
}
