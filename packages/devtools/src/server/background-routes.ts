import type { FastifyInstance } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

/** Registers the route that returns work recorded outside any request. */
export function registerBackgroundRoutes(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  server.get("/api/background", async () => deps.collector.getBackground());
}
