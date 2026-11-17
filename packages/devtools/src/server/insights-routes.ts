import type { FastifyInstance } from "fastify";
import { DevtoolsApiError } from "../production/errors";
import type { DevtoolsInsightQuery, DevtoolsInsights } from "../production/insights/types";
import type { MountDevtoolsRoutesDeps } from "./types";

type InsightsQuerystring = { instance?: string; sort?: string; limit?: string };

const QUERY_SORTS = ["total", "p95", "count", "n+1"] as const;
const ROUTE_SORTS = ["total", "p95", "count", "errors"] as const;

/**
 * Reads `?instance=&sort=&limit=`. A sort outside `sorts` or a limit that is
 * not a whole number from 1 to 500 answers `input.invalid`.
 */
export function parseInsightQuery(
  query: InsightsQuerystring,
  sorts?: readonly string[],
): DevtoolsInsightQuery {
  const result: DevtoolsInsightQuery = { instance: query.instance || "all" };

  if (sorts && query.sort !== undefined && query.sort !== "") {
    if (!sorts.includes(query.sort)) throw new DevtoolsApiError("input.invalid");

    result.sort = query.sort;
  }

  if (query.limit !== undefined && query.limit !== "") {
    const limit = Number(query.limit);

    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new DevtoolsApiError("input.invalid");
    }

    result.limit = limit;
  }

  return result;
}

/**
 * The read-only routes of the Resources, Queries (statistics), Routes
 * (statistics), Health, Errors, Logs (production) and Jobs tabs, over
 * `deps.insights`: `GET /api/instances`, `/api/resources`,
 * `/api/queries/stats`, `/api/routes/stats`, `/api/health`, `/api/errors`,
 * `/api/jobs`. Each takes `?instance=<id|all>` (default `all`). Without
 * `deps.insights` nothing is registered.
 */
export function registerInsightsRoutes(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  const insights: DevtoolsInsights | undefined = deps.insights;

  if (!insights) return;

  const route = (
    path: string,
    sorts: readonly string[] | undefined,
    read: (query: DevtoolsInsightQuery) => Promise<unknown>,
  ): void => {
    server.get<{ Querystring: InsightsQuerystring }>(path, async (request, reply) => {
      const query = parseInsightQuery(request.query, sorts);

      reply.header("Cache-Control", "no-store");

      return read(query);
    });
  };

  route("/api/instances", undefined, () => insights.instances());
  route("/api/resources", undefined, (query) => insights.resources(query));
  route("/api/queries/stats", QUERY_SORTS, (query) => insights.queryStats(query));
  route("/api/routes/stats", ROUTE_SORTS, (query) => insights.routeStats(query));
  route("/api/health", undefined, (query) => insights.health(query));
  route("/api/errors", undefined, (query) => insights.errors(query));
  route("/api/jobs", undefined, (query) => insights.jobs(query));
}
