import type { FastifyInstance } from "fastify";
import { listAiRuns, type DevtoolsAiRunsQuery } from "../ai/reports/runs";
import { DevtoolsApiError } from "../production/errors";
import { AGENT_TRACE_INSTALL_GUIDANCE } from "../sources/agent-trace-source";
import { describeAiUnavailable, toAiUnavailableView } from "../sources/ai-source";
import type { MountDevtoolsRoutesDeps } from "./types";

/** Read-only AI metadata, inside the same development/loopback guard as every panel. */
export function registerAiRoutes(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.get<{ Querystring: { requestId?: string } }>("/api/ai", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const source = deps.ai;
    if (!source?.available) {
      if (!source) {
        // Production never attaches the feed: say so instead of claiming AI is missing.
        const reason = deps.mode === "production" ? "not-collected" : "ai-missing";
        return { ...describeAiUnavailable(reason), runs: [] };
      }
      const { dispose: _dispose, ...unavailable } = source;
      return { ...unavailable, runs: [] };
    }
    const filter =
      request.query.requestId === undefined ? undefined : { requestId: request.query.requestId };
    const runs = source.store.query(filter).map(source.summarize);
    // Nothing collected and nothing that would collect: say how to turn it on.
    if (!runs.length && filter === undefined && source.observationOff?.()) {
      return { ...describeAiUnavailable("observation-off"), runs: [] };
    }
    return {
      available: true,
      runs,
      aggregate: source.store.aggregate(filter),
    };
  });

  // The filtered, grouped and summarised run list the Runs page reads. Production keeps no run details.
  server.get<{ Querystring: DevtoolsAiRunsQuery }>("/api/ai/runs", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const source = deps.ai;

    if (!source) {
      return toAiUnavailableView(
        describeAiUnavailable(deps.mode === "production" ? "not-collected" : "ai-missing"),
      );
    }

    if (!source.available) {
      const { dispose: _dispose, ...unavailable } = source;

      return toAiUnavailableView(unavailable);
    }

    try {
      return listAiRuns(source.store.query(), request.query, {
        totalCost: source.totalCost,
        capacity: deps.options.maxRequests,
        helpers: source.helpers,
      });
    } catch (error) {
      if (error instanceof DevtoolsApiError)
        return reply.code(error.statusCode).send(error.toBody());

      throw error;
    }
  });

  // Per-turn agent traces recorded by `@warlock.js/ai` itself (system prompt,
  // tools offered, tool calls, refusals, retries, usage and cost). Unlike the
  // Panoptic feed above, these carry prompt and tool content: they exist for
  // debugging in development and sit behind the same guard.
  server.get<{ Querystring: { requestId?: string } }>(
    "/api/ai/agent-runs",
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const source = deps.agentTraces;

      if (!source?.available()) {
        return { available: false, message: AGENT_TRACE_INSTALL_GUIDANCE, runs: [] };
      }

      return {
        available: true,
        runs: source.list(
          request.query.requestId === undefined
            ? undefined
            : { requestId: request.query.requestId },
        ),
      };
    },
  );

  server.get<{ Params: { id: string } }>("/api/ai/agent-runs/:id", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const trace = deps.agentTraces?.get(request.params.id);

    if (!trace) return reply.code(404).send();

    return trace;
  });

  server.get<{ Params: { id: string } }>("/api/ai/runs/:id", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const source = deps.ai;
    const trace = source?.available ? source.store.get(request.params.id) : undefined;
    if (!trace) return reply.code(404).send();
    return trace;
  });
}
