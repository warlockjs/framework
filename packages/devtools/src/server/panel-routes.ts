import type { FastifyInstance } from "fastify";
import { type MountedDevtoolsPanel, panelContentType } from "../panels";
import type { DevtoolsPanelRequest } from "../types";
import { sendFile } from "./ui-assets";

/**
 * Mounts each panel's data routes at `/api/<id><route path>` and its view
 * module and assets at `/panels/<id>/<name>`. Callers register this inside
 * the devtools scope, so the guard covers every one of them. A file is
 * served only when its name is listed by the panel; the request never
 * becomes a filesystem path.
 */
export function registerPanelRoutes(
  server: FastifyInstance,
  panels: readonly MountedDevtoolsPanel[],
): void {
  const byId = new Map(panels.map((panel) => [panel.id, panel]));

  for (const panel of panels) {
    for (const route of panel.routes) {
      server.route({
        method: route.method,
        url: `/api/${panel.id}${route.path}`,
        handler: async (request, reply) => {
          const input: DevtoolsPanelRequest = {
            params: (request.params ?? {}) as Record<string, string>,
            query: (request.query ?? {}) as Record<string, string | string[]>,
            body: request.body,
          };
          const result = await route.handler(input);

          reply.header("cache-control", "no-store");

          if (result === undefined) return reply.code(204).send();

          return result;
        },
      });
    }
  }

  server.get<{ Params: { id: string; name: string } }>("/panels/:id/:name", (request, reply) => {
    const panel = byId.get(request.params.id);
    const name = request.params.name;
    const file =
      panel === undefined
        ? undefined
        : name === "view.js"
          ? panel.view
          : Object.hasOwn(panel.assets, name)
            ? panel.assets[name]
            : undefined;

    if (file === undefined) {
      reply.code(404).header("Cache-Control", "no-store").send();
      return;
    }

    reply.header("X-Content-Type-Options", "nosniff");
    sendFile(reply, file, panelContentType(name));
  });
}
