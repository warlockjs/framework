import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Module = Record<string, unknown>;

/** Stand-ins for the route files other packages own: one canned answer per route. */
export const requestsRoutes = {
  registerRequestsRoutes(server: FastifyInstance): void {
    server.get("/api/requests", async () => []);
    server.get("/api/requests/:id", async (request) => ({
      id: (request.params as { id: string }).id,
    }));
    server.get("/api/requests/:id/curl", async () => ({ curl: "curl x" }));
    server.delete("/api/requests", async () => ({ cleared: 1 }));
    // A route nobody listed in the access table: it must default to admin.
    server.get("/api/unlisted", async () => ({ unlisted: true }));
  },
};

export const insightsRoutes = {
  registerInsightsRoutes(server: FastifyInstance): void {
    for (const route of [
      "instances",
      "resources",
      "queries/stats",
      "routes/stats",
      "health",
      "errors",
      "jobs",
    ]) {
      server.get(`/api/${route}`, async () => ({ route }));
    }
  },
};

export const logRoutes = {
  registerLogRoutes(server: FastifyInstance): void {
    server.get("/api/logs", async () => []);
  },
};

export const explainRoute = {
  registerExplainRoute(): void {
    // The per-request EXPLAIN is development only; the production mount must not call it.
    throw new Error("registerExplainRoute must not run in the production mount");
  },
  registerShapeExplainRoute(server: FastifyInstance): void {
    server.post("/api/queries/:shapeId/explain", async (request) => ({
      shapeId: (request.params as { shapeId: string }).shapeId,
    }));
  },
};

export function uiAssets(original: Module): Module {
  return {
    ...original,
    registerUiAssets(
      server: FastifyInstance,
      options: { notFound?: (request: FastifyRequest, reply: FastifyReply) => FastifyReply } = {},
    ): void {
      server.get("/", (_request, reply) => {
        reply.header("Content-Type", "text/html; charset=utf-8").send("<html>shell</html>");
      });
      server.get<{ Params: { name: string } }>("/assets/:name", (request, reply) => {
        // The real registrar answers an unknown name through `notFound` the same way.
        if (request.params.name !== "app.js" && options.notFound) {
          options.notFound(request, reply);
          return;
        }

        reply.header("Content-Type", "text/javascript; charset=utf-8").send("export {}");
      });
    },
  };
}
