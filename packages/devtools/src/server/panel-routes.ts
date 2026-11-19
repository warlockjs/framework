import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type MountedDevtoolsPanel, panelContentType } from "../panels";
import type { DevtoolsPanelRequest } from "../types";
import { resolvePanelFile } from "./panel-files";
import { sendFile } from "./ui-assets";

/** Answers 404; the production mount passes its uniform not-found answer. */
export type PanelNotFound = (
  request: FastifyRequest,
  reply: FastifyReply,
) => FastifyReply | Promise<FastifyReply>;

/** Sends one image of a panel's folder with its content type, or answers 404. */
export async function sendPanelFile(
  panel: Pick<MountedDevtoolsPanel, "files">,
  requested: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  notFound: PanelNotFound,
): Promise<FastifyReply | void> {
  const file = panel.files === null ? null : await resolvePanelFile(panel.files, requested);

  if (file === null) return notFound(request, reply);

  reply
    .header("X-Content-Type-Options", "nosniff")
    .header("Cache-Control", "no-store")
    .header("Content-Type", panelContentType(file));

  return reply.send(createReadStream(file));
}

/**
 * Mounts each panel's data routes at `/api/<id><route path>`, its view
 * module and assets at `/panels/<id>/<name>`, and its folder of images at
 * `/panels/<id>/files/<path>`. Callers register this inside the devtools
 * scope, so the guard covers every one of them. A file is served only when
 * its name is listed by the panel (or, for `files`, resolves inside the
 * panel's folder with a listed extension); the request never becomes a
 * filesystem path on its own.
 */
export function registerPanelRoutes(
  server: FastifyInstance,
  panels: readonly MountedDevtoolsPanel[],
  options: { notFound?: PanelNotFound } = {},
): void {
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const notFound: PanelNotFound =
    options.notFound ??
    ((_request, reply) => {
      reply.code(404).header("Cache-Control", "no-store").send();

      return reply;
    });

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

  server.get<{ Params: { id: string; "*": string } }>(
    "/panels/:id/files/*",
    async (request, reply) => {
      const panel = byId.get(request.params.id);

      if (panel === undefined) return notFound(request, reply);

      return sendPanelFile(panel, request.params["*"], request, reply, notFound);
    },
  );

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
