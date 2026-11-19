import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  "app.js": {
    contentType: "text/javascript; charset=utf-8",
    file: uiFile("dashboard/assets/app.js"),
  },
  "app.css": { contentType: "text/css; charset=utf-8", file: uiFile("dashboard/assets/app.css") },
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

const NOT_BUILT_HTML =
  "<!doctype html><title>Warlock Devtools</title><p>The devtools dashboard has not been built. Run <code>pnpm --filter @warlock.js/devtools build:ui</code>.</p>";

/**
 * Serves the static dashboard: the built `ui/dashboard/index.html` at the
 * dashboard root and the whitelisted assets (`app.js`, `app.css`, the
 * vendored Scalar bundle as `scalar.js`, and the vendored Swagger UI files
 * plus their init script). The asset name is matched against a fixed
 * whitelist — never joined into a filesystem path — so no request can
 * traverse outside it. Before the first `build:ui` the root answers 503 with
 * a note that says how to build. `notFound` answers an unknown asset (the
 * production gate passes its uniform 404, so the public asset route answers
 * like any unknown URL of the app); without it the answer is a bare 404.
 */
export function registerUiAssets(
  server: FastifyInstance,
  options: {
    notFound?: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => FastifyReply | Promise<FastifyReply>;
  } = {},
): void {
  const serveIndex = (request: FastifyRequest, reply: FastifyReply): void => {
    // The address as sent: core's server drops a trailing slash before routing.
    const [pathname = "", search] = (request.originalUrl ?? request.url).split("?");

    // The page loads its assets by relative URL, so it must be served from `<path>/`. The target is built from
    // the route, never from the request, so it always stays on the dashboard path.
    if (!pathname.endsWith("/")) {
      const base = (request.routeOptions.url ?? pathname).replace(/\/+$/, "");

      reply
        .code(308)
        .header("Cache-Control", "no-store")
        .redirect(`${base}/${search === undefined ? "" : `?${search}`}`, 308);
      return;
    }

    const index = path.join(resolveUiRoot(), "dashboard", "index.html");

    if (!existsSync(index)) {
      reply
        .code(503)
        .header("Cache-Control", "no-store")
        .header("Content-Type", "text/html; charset=utf-8")
        .send(NOT_BUILT_HTML);
      return;
    }

    reply
      .header("Cache-Control", "no-store")
      .header("Content-Type", "text/html; charset=utf-8")
      .send(readFileSync(index));
  };

  server.get("/", serveIndex);

  server.get<{ Params: { name: string } }>("/assets/:name", async (request, reply) => {
    const asset = Object.hasOwn(UI_ASSETS, request.params.name)
      ? UI_ASSETS[request.params.name]
      : undefined;
    const file = asset?.file();

    if (!asset || !file || !existsSync(file)) {
      if (options.notFound) {
        return options.notFound(request, reply);
      }

      return reply.code(404).header("Cache-Control", "no-store").send();
    }

    sendFile(reply, file, asset.contentType);

    return reply;
  });
}
