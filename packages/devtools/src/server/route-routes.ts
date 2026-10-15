import type { FastifyInstance } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

/** Registers the route map, sourced from core's router via `deps.listRoutes`. */
export function registerRouteRoutes(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.get("/api/routes", async () => (deps.listRoutes ? deps.listRoutes() : []));
}
