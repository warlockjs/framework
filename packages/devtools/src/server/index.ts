import type { FastifyError, FastifyInstance } from "fastify";
import { registerBackgroundRoutes } from "./background-routes";
import { registerExplainRoute } from "./explain-route";
import { registerDevtoolsGuard } from "./guard";
import { registerLogRoutes } from "./log-routes";
import { registerMailRoutes } from "./mail-routes";
import { registerOpenApiRoutes } from "./openapi-routes";
import { registerRequestsRoutes } from "./requests-routes";
import { registerRouteRoutes } from "./route-routes";
import { registerStreamRoute } from "./stream-route";
import type { MountDevtoolsRoutesDeps } from "./types";
import { registerUiAssets } from "./ui-assets";

export type { DevtoolsRouteRow, MountDevtoolsRoutesDeps } from "./types";

/**
 * Mounts the devtools dashboard and its API under `deps.options.path` on
 * `server`. Every route is registered inside a single encapsulated Fastify
 * context so the dev-only, loopback-only guard never reaches the app's
 * other routes.
 */
export function mountDevtoolsRoutes(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.register(
    async (instance) => {
      registerDevtoolsGuard(instance, deps);

      instance.setErrorHandler((error: FastifyError, _request, reply) => {
        reply.code(error.statusCode ?? 500).send({ error: error.message });
      });

      registerUiAssets(instance);
      registerRequestsRoutes(instance, deps);
      registerBackgroundRoutes(instance, deps);
      registerMailRoutes(instance, deps);
      registerLogRoutes(instance, deps);
      registerRouteRoutes(instance, deps);
      registerOpenApiRoutes(instance, deps);
      registerExplainRoute(instance, deps);
      registerStreamRoute(instance, deps);
    },
    { prefix: deps.options.path },
  );
}
