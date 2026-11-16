import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { MountedDevtoolsPanel } from "../panels";
import { resolveUiRoot } from "../ui-root";

/** Where `index.html` takes the registered panels' tab buttons. */
const PANEL_TABS_MARKER = "<!-- devtools:panel-tabs -->";

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
  "swagger-ui-bundle.js": {
    contentType: "text/javascript; charset=utf-8",
    file: uiFile("vendor/swagger-ui/swagger-ui-bundle.js"),
  },
  "swagger-ui.css": {
    contentType: "text/css; charset=utf-8",
    file: uiFile("vendor/swagger-ui/swagger-ui.css"),
  },
  "docs-swagger.js": {
    contentType: "text/javascript; charset=utf-8",
    file: uiFile("docs-swagger.js"),
  },
};

/** Sends `file` with `contentType` and no caching. */
export function sendFile(reply: FastifyReply, file: string, contentType: string): void {
  reply
    .header("Cache-Control", "no-store")
    .header("Content-Type", contentType)
    .send(readFileSync(file));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** `index.html` with one tab button per registered panel, in registration order. */
export function renderIndexHtml(html: string, panels: readonly MountedDevtoolsPanel[]): string {
  const buttons = panels
    .map(
      (panel) =>
        `<button class="tab" data-tab="${panel.id}" data-panel="${panel.id}">${escapeHtml(panel.title)}</button>`,
    )
    .join("\n        ");

  return html.replace(PANEL_TABS_MARKER, buttons);
}

/**
 * Serves the static dashboard: `index.html` at the dashboard root (with a
 * tab per registered panel) and the whitelisted assets (`app.js`, `app.css`,
 * the vendored Scalar bundle as `scalar.js`, and the vendored Swagger UI
 * files plus their init script). The asset name is matched against a fixed
 * whitelist — never joined into a filesystem path — so no request can
 * traverse outside it.
 */
export function registerUiAssets(
  server: FastifyInstance,
  panels: readonly MountedDevtoolsPanel[] = [],
): void {
  const serveIndex = (_request: unknown, reply: FastifyReply): void => {
    const html = readFileSync(path.join(resolveUiRoot(), "index.html"), "utf8");

    reply
      .header("Cache-Control", "no-store")
      .header("Content-Type", "text/html; charset=utf-8")
      .send(renderIndexHtml(html, panels));
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
