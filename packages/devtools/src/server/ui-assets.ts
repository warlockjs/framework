import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUiRoot } from "../ui-root";

/**
 * Where an asset's bytes come from: a file in this package's `ui/` folder.
 */
type UiAsset = {
  contentType: string;
  file: () => string;
};

const uiFile = (name: string) => () => path.join(resolveUiRoot(), name);

/**
 * The only assets that can be requested. The request's asset name is looked
 * up here and never joined into a filesystem path.
 */
const UI_ASSETS: Record<string, UiAsset> = {
  "app.js": { contentType: "text/javascript; charset=utf-8", file: uiFile("app.js") },
  "app.css": { contentType: "text/css; charset=utf-8", file: uiFile("app.css") },
  "scalar.js": {
    contentType: "text/javascript; charset=utf-8",
    file: uiFile("vendor/scalar/standalone.js"),
  },
};

/** Sends `file` with `contentType` and no caching. */
export function sendFile(reply: FastifyReply, file: string, contentType: string): void {
  reply
    .header("Cache-Control", "no-store")
    .header("Content-Type", contentType)
    .send(readFileSync(file));
}

/**
 * Serves the static dashboard: `index.html` at the dashboard root and the
 * whitelisted assets (`app.js`, `app.css`, and the vendored Scalar bundle
 * as `scalar.js`). The asset name is matched against a fixed whitelist — never
 * joined into a filesystem path — so no request can traverse outside it.
 */
export function registerUiAssets(server: FastifyInstance): void {
  const serveIndex = (_request: unknown, reply: FastifyReply): void => {
    sendFile(reply, path.join(resolveUiRoot(), "index.html"), "text/html; charset=utf-8");
  };

  server.get("/", serveIndex);

  server.get<{ Params: { name: string } }>("/assets/:name", (request, reply) => {
    const asset = Object.hasOwn(UI_ASSETS, request.params.name)
      ? UI_ASSETS[request.params.name]
      : undefined;

    if (!asset) {
      reply.code(404).header("Cache-Control", "no-store").send();
      return;
    }

    sendFile(reply, asset.file(), asset.contentType);
  });
}
