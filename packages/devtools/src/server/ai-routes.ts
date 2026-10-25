import type { FastifyInstance } from "fastify";
import { AGENT_TRACE_INSTALL_GUIDANCE } from "../sources/agent-trace-source";
import { AI_INSTALL_GUIDANCE } from "../sources/ai-source";
import type { MountDevtoolsRoutesDeps } from "./types";

/** Read-only AI metadata, inside the same development/loopback guard as every panel. */
export function registerAiRoutes(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.get<{ Querystring: { requestId?: string } }>("/api/ai", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const source = deps.ai;
    if (!source?.available) {
      return { available: false, message: source?.message ?? AI_INSTALL_GUIDANCE, runs: [] };
    }
    const filter =
      request.query.requestId === undefined ? undefined : { requestId: request.query.requestId };
    return {
      available: true,
      runs: source.store.query(filter).map(source.summarize),
      aggregate: source.store.aggregate(filter),
    };
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
          request.query.requestId === undefined ? undefined : { requestId: request.query.requestId },
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
