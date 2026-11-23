import type { FastifyError, FastifyInstance } from "fastify";
import { checkDevtoolsPanels } from "../panels";
import { createErrorRef } from "../production/errors";
import { processesDevtoolsPanel } from "../process-panel";
import { registerAiReportRoutes } from "./ai-report-routes";
import { registerAiRoutes } from "./ai-routes";
import { registerBackgroundRoutes } from "./background-routes";
import { registerExplainRoute, registerShapeExplainRoute } from "./explain-route";
import { registerInsightsRoutes } from "./insights-routes";
import { registerDevtoolsGuard } from "./guard";
import { registerLogRoutes } from "./log-routes";
import { registerMailRoutes } from "./mail-routes";
import { registerOpenApiRoutes } from "./openapi-routes";
import { registerPanelRoutes } from "./panel-routes";
import { registerRequestsRoutes } from "./requests-routes";
import { registerRouteRoutes } from "./route-routes";
import { registerSessionRoutes } from "./session-routes";
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

      instance.setErrorHandler((error: FastifyError, request, reply) => {
        const status = error.statusCode ?? 500;

        if (status < 500) return reply.code(status).send({ error: error.message });

        // A failure of the server itself carries a short reference, written to the log, that the dashboard shows.
        const ref = createErrorRef();

        deps.warn?.(`Devtools error ${ref} on ${request.method} ${request.url}: ${error.message}`);
        request.log.error({ ref, err: error }, "devtools error");

        return reply.code(status).send({ error: error.message, ref });
      });

      registerUiAssets(instance);
      registerSessionRoutes(instance, deps, panels);
      registerRequestsRoutes(instance, deps);
      registerAiRoutes(instance, deps);
      registerAiReportRoutes(instance, deps);
      registerBackgroundRoutes(instance, deps);
      registerMailRoutes(instance, deps);
      registerLogRoutes(instance, deps);
      registerRouteRoutes(instance, deps);
      registerPanelRoutes(instance, panels);
      registerOpenApiRoutes(instance, deps);
      registerExplainRoute(instance, deps);
      registerShapeExplainRoute(instance, deps);
      if (deps.insights) registerInsightsRoutes(instance, deps);
      registerStreamRoute(instance, deps);
    },
    { prefix: deps.options.path },
  );
}
