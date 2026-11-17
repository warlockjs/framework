import type { FastifyInstance } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

/**
 * The read-only routes of the Resources, Queries (statistics), Routes
 * (statistics), Health, Errors, Logs (production) and Jobs tabs, over
 * `deps.insights`: `GET /api/instances`, `/api/resources`,
 * `/api/queries/stats`, `/api/routes/stats`, `/api/health`, `/api/errors`,
 * `/api/jobs`. Each takes `?instance=<id|all>` (default `all`). Without
 * `deps.insights` nothing is registered.
 *
 * Owner: WP-5.
 */
export function registerInsightsRoutes(
  _server: FastifyInstance,
  _deps: MountDevtoolsRoutesDeps,
): void {
  throw new Error("not implemented");
}
