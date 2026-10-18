import type { FastifyInstance } from "fastify";
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

  server.get<{ Params: { id: string } }>("/api/ai/runs/:id", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const source = deps.ai;
    const trace = source?.available ? source.store.get(request.params.id) : undefined;
    if (!trace) return reply.code(404).send();
    return trace;
  });
}
