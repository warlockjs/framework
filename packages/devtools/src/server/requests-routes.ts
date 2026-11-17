import type { RequestLogFilter } from "@warlock.js/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { DevtoolsApiError } from "../production/errors";
import type { DevtoolsSampleFilter } from "../production/store/types";
import {
  filterFromQuery,
  hasFilter,
  mergeRequestHistory,
  recordToDetail,
  summaryToRow,
} from "../request-history";
import type { DevtoolsRequestDetail } from "../types";
import type { MountDevtoolsRoutesDeps } from "./types";

const STATUS_FILTER = /^(?:[1-5]\d\d|[1-5]xx)$/i;
const METHOD_FILTER = /^[A-Za-z]{1,16}$/;
const RELATIVE_SINCE = /^(\d+)(s|m|h|d)$/;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const DEFAULT_SAMPLE_LIMIT = 200;
const MAX_SAMPLE_LIMIT = 1000;

/** A time bound as epoch ms: a number, an ISO date, or (for `since`) a duration back such as `15m`. */
function parseTimeBound(value: string, allowRelative: boolean): number {
  if (/^\d+$/.test(value)) return Number(value);

  const relative = allowRelative ? RELATIVE_SINCE.exec(value) : null;

  if (relative) {
    return Date.now() - Number(relative[1]) * UNIT_MS[relative[2] as keyof typeof UNIT_MS];
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) throw new DevtoolsApiError("request.invalid-filter");

  return parsed;
}

/** The stored-sample filter in a `GET /api/requests` query string; throws `request.invalid-filter`. */
function sampleFilterFromQuery(
  query: Record<string, unknown>,
  filter: RequestLogFilter,
  fallbackLimit: number,
): DevtoolsSampleFilter {
  const result: DevtoolsSampleFilter = {
    limit: Math.min(MAX_SAMPLE_LIMIT, filter.limit ?? fallbackLimit),
  };

  if (filter.status !== undefined) {
    const status = String(filter.status);

    if (!STATUS_FILTER.test(status)) throw new DevtoolsApiError("request.invalid-filter");

    result.status = status.toLowerCase();
  }

  if (filter.method !== undefined) {
    if (!METHOD_FILTER.test(String(filter.method))) {
      throw new DevtoolsApiError("request.invalid-filter");
    }

    result.method = String(filter.method);
  }

  if (filter.route !== undefined) result.route = String(filter.route);
  if (filter.q !== undefined) result.q = String(filter.q);
  if (filter.since !== undefined) result.since = parseTimeBound(String(filter.since), true);
  if (filter.until !== undefined) result.until = parseTimeBound(String(filter.until), false);

  const instance = query.instance;

  if (typeof instance === "string" && instance.trim() !== "" && instance !== "all") {
    result.instance = instance.trim();
  }

  return result;
}

function sendApiError(reply: FastifyReply, error: DevtoolsApiError): void {
  reply.code(error.statusCode).send(error.toBody());
}

/**
 * Production: the same four routes over the request source (stored samples
 * and this process's memory), merged with the persisted request log the way
 * development merges it with the ring buffer.
 */
function registerProductionRequestsRoutes(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  const source = deps.requests;

  if (!source) return;

  server.get<{ Querystring: Record<string, unknown> }>("/api/requests", async (request, reply) => {
    const { requestLog, options } = deps;

    try {
      const filter = filterFromQuery(request.query);
      const sampleFilter = sampleFilterFromQuery(request.query, filter, DEFAULT_SAMPLE_LIMIT);
      const limit = Math.min(MAX_SAMPLE_LIMIT, filter.limit ?? options.maxRequests);
      let persisted: Awaited<ReturnType<NonNullable<typeof requestLog>["list"]>> = [];

      if (requestLog) {
        try {
          requestLog.compile(filter);
          persisted = await requestLog.list({ ...filter, limit });
        } catch (error) {
          // A bad filter value is the caller's mistake; a read failure leaves the samples.
          if (error instanceof Error && /^Invalid /.test(error.message)) {
            throw new DevtoolsApiError("request.invalid-filter");
          }
        }
      }

      const samples = await source.list({ ...sampleFilter, limit });

      return mergeRequestHistory(samples, persisted, limit);
    } catch (error) {
      if (error instanceof DevtoolsApiError) {
        sendApiError(reply, error);
        return;
      }

      throw error;
    }
  });

  server.get<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => {
    const { id } = request.params;
    const persisted = await deps.requestLog?.get(id).catch(() => undefined);
    const found = await source.get(id);

    if (found) {
      const hasTimeline = "phases" in found;

      if (hasTimeline) return persisted ? { ...found, record: persisted } : found;

      // A slow or failed request that was not sampled: the summary, plus what the log kept.
      if (persisted) {
        return {
          ...recordToDetail(persisted),
          ...(found.instance === undefined ? {} : { instance: found.instance }),
          partial: true,
        };
      }

      return found;
    }

    if (!persisted) {
      sendApiError(reply, new DevtoolsApiError("request.not-found"));
      return;
    }

    return recordToDetail(persisted);
  });

  server.get<{ Params: { id: string } }>("/api/requests/:id/curl", async (request, reply) => {
    const { id } = request.params;
    const baseUrl = `${request.protocol}://${request.headers.host ?? "localhost"}`;
    const persisted = await deps.requestLog?.get(id).catch(() => undefined);

    if (persisted && deps.requestLog) return { curl: deps.requestLog.curl(persisted, baseUrl) };

    const found = await source.get(id);

    if (!found) {
      sendApiError(reply, new DevtoolsApiError("request.not-found"));
      return;
    }

    return { curl: `curl -X ${found.method} '${baseUrl}${found.path.replace(/'/g, `'\\''`)}'` };
  });

  server.delete("/api/requests", async (_request, reply) => {
    await source.clear();
    deps.collector.clear();
    reply.code(204).send();
  });
}

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
  if (deps.requests) {
    registerProductionRequestsRoutes(server, deps);
    return;
  }

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
