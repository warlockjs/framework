import path from "node:path";
import type { FastifyInstance } from "fastify";
import { resolveUiRoot } from "../ui-root";
import type { MountDevtoolsRoutesDeps } from "./types";
import { sendFile } from "./ui-assets";

/**
 * Registers the API docs: `GET /api/openapi.json` returns the document core
 * builds from the registered routes (`deps.getOpenApiDocument`), and
 * `GET /docs` serves the page that renders it with Scalar. The page uses
 * relative URLs, so it works under whatever base path the dashboard is
 * mounted on.
 */
export function registerOpenApiRoutes(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  server.get("/api/openapi.json", async (_request, reply) => {
    if (!deps.getOpenApiDocument) {
      return reply.code(503).header("Cache-Control", "no-store").send({
        error: "The OpenAPI document is not available: the host did not provide a generator.",
      });
    }

    reply.header("Cache-Control", "no-store");

    return deps.getOpenApiDocument();
  });

  server.get("/docs", (_request, reply) => {
    sendFile(reply, path.join(resolveUiRoot(), "docs.html"), "text/html; charset=utf-8");
  });
}
