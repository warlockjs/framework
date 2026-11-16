import type { FastifyError, FastifyInstance } from "fastify";
import { checkDevtoolsPanels } from "../panels";
import { processesDevtoolsPanel } from "../process-panel";
import { registerAiRoutes } from "./ai-routes";
import { registerBackgroundRoutes } from "./background-routes";
import { registerExplainRoute } from "./explain-route";
import { registerDevtoolsGuard } from "./guard";
import { registerLogRoutes } from "./log-routes";
import { registerMailRoutes } from "./mail-routes";
import { registerOpenApiRoutes } from "./openapi-routes";
import { registerPanelRoutes } from "./panel-routes";
import { registerRequestsRoutes } from "./requests-routes";
import { registerRouteRoutes } from "./route-routes";
import { registerStreamRoute } from "./stream-route";
import type { MountDevtoolsRoutesDeps } from "./types";
import { registerUiAssets } from "./ui-assets";

export type { DevtoolsRequestLogSource, DevtoolsRouteRow, MountDevtoolsRoutesDeps } from "./types";

/**
 * Mounts the devtools dashboard and its API under `deps.options.path` on
 * `server`. Every route is registered inside a single encapsulated Fastify
 * context so the dev-only, loopback-only guard never reaches the app's
 * other routes — the registered panels' data routes and files included.
 *
 * Throws before mounting anything when a panel is invalid or reuses an id.
 */
export function mountDevtoolsRoutes(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  const panels = checkDevtoolsPanels([
    processesDevtoolsPanel(deps.processPanel),
    ...(deps.panels ?? []),
  ]);

  server.register(
    async (instance) => {
      registerDevtoolsGuard(instance, deps);

      instance.setErrorHandler((error: FastifyError, _request, reply) => {
        reply.code(error.statusCode ?? 500).send({ error: error.message });
      });

      registerUiAssets(instance, panels);
      registerRequestsRoutes(instance, deps);
      registerAiRoutes(instance, deps);
      registerBackgroundRoutes(instance, deps);
      registerMailRoutes(instance, deps);
      registerLogRoutes(instance, deps);
      registerRouteRoutes(instance, deps);
      registerPanelRoutes(instance, panels);
      registerOpenApiRoutes(instance, deps);
      registerExplainRoute(instance, deps);
      registerStreamRoute(instance, deps);
    },
    { prefix: deps.options.path },
  );
}
