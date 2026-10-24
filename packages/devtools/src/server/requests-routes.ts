import type { FastifyInstance } from "fastify";
import {
  filterFromQuery,
  hasFilter,
  mergeRequestHistory,
  recordToDetail,
  summaryToRow,
} from "../request-history";
import type { DevtoolsRequestDetail } from "../types";
import type { MountDevtoolsRoutesDeps } from "./types";

/**
 * Registers the request list, single-request detail, "copy as curl", and
 * clear routes.
 *
 * With core's persistent request log available, the list and the detail also
 * read the JSON-lines history, so requests survive a restart. The list
 * accepts `status` (404 or 5xx), `route`, `method`, `since`, `until`, `q`
 * and `limit` query parameters.
 */
export function registerRequestsRoutes(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  server.get<{ Querystring: Record<string, unknown> }>("/api/requests", async (request, reply) => {
    const { requestLog, collector, options } = deps;

    if (!requestLog) return collector.listRequests();

    try {
      const filter = filterFromQuery(request.query);
      const matches = requestLog.compile(filter);
      const live = hasFilter(filter)
        ? collector.listRequests().filter((summary) => matches(summaryToRow(summary)))
        : collector.listRequests();
      const limit = filter.limit ?? options.maxRequests;
      const persisted = await requestLog.list({ ...filter, limit });

      return mergeRequestHistory(live, persisted, limit);
    } catch (error) {
      // A bad filter value is the caller's mistake; a read failure leaves the live list.
      if (error instanceof Error && /^Invalid /.test(error.message)) {
        reply.code(400).send({ error: error.message });
        return;
      }

      return collector.listRequests();
    }
  });

  server.get<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => {
    const { id } = request.params;
    const persisted = await deps.requestLog?.get(id).catch(() => undefined);
    const found = deps.collector.getRequest(id);

    if (found) {
      const detail: DevtoolsRequestDetail = persisted ? { ...found, record: persisted } : found;

      return detail;
    }

    if (!persisted) {
      reply.code(404).send();
      return;
    }

    return recordToDetail(persisted);
  });

  server.get<{ Params: { id: string } }>("/api/requests/:id/curl", async (request, reply) => {
    const { id } = request.params;
    const baseUrl = `${request.protocol}://${request.headers.host ?? "localhost"}`;
    const persisted = await deps.requestLog?.get(id).catch(() => undefined);

    if (persisted && deps.requestLog) return { curl: deps.requestLog.curl(persisted, baseUrl) };

    // Without a persisted record only the method and path are known.
    const live = deps.collector.getRequest(id);

    if (!live) {
      reply.code(404).send();
      return;
    }

    return { curl: `curl -X ${live.method} '${baseUrl}${live.path.replace(/'/g, `'\\''`)}'` };
  });

  server.delete("/api/requests", async (_request, reply) => {
    deps.collector.clear();
    if (deps.ai?.available) deps.ai.store.clear();
    reply.code(204).send();
  });
}
