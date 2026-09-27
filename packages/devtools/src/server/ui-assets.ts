import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUiRoot } from "../ui-root";

const ASSET_CONTENT_TYPES: Record<string, string> = {
  "app.js": "text/javascript; charset=utf-8",
  "app.css": "text/css; charset=utf-8",
};

function sendFile(reply: FastifyReply, file: string, contentType: string): void {
  reply
    .header("Cache-Control", "no-store")
    .header("Content-Type", contentType)
    .send(readFileSync(file));
}

/**
 * Serves the static dashboard: `index.html` at the dashboard root and the
 * two named assets. The asset name is matched against a fixed whitelist —
 * never joined into a filesystem path — so no request can traverse outside
 * `ui/`.
 */
export function registerUiAssets(server: FastifyInstance): void {
  const serveIndex = (_request: unknown, reply: FastifyReply): void => {
    const uiRoot = resolveUiRoot();
    sendFile(reply, path.join(uiRoot, "index.html"), "text/html; charset=utf-8");
  };

  server.get("/", serveIndex);

  server.get<{ Params: { name: string } }>("/assets/:name", (request, reply) => {
    const contentType = ASSET_CONTENT_TYPES[request.params.name];

    if (!contentType) {
      reply.code(404).header("Cache-Control", "no-store").send();
      return;
    }

    const uiRoot = resolveUiRoot();
    sendFile(reply, path.join(uiRoot, request.params.name), contentType);
  });
}
