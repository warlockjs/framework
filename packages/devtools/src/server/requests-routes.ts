import type { FastifyInstance } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

/** Registers the request list, single-request detail, and clear routes. */
export function registerRequestsRoutes(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  server.get("/api/requests", async () => deps.collector.listRequests());

  server.get<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => {
    const found = deps.collector.getRequest(request.params.id);

    if (!found) {
      reply.code(404).send();
      return;
    }

    return found;
  });

  server.delete("/api/requests", async (_request, reply) => {
    deps.collector.clear();
    reply.code(204).send();
  });
}
