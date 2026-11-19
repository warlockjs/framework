import type { FastifyInstance } from "fastify";
import { readVersions } from "../app-versions";
import { listPanelInfos, type MountedDevtoolsPanel } from "../panels";
import type { DevtoolsPanelInfo, DevtoolsSessionView } from "../production/contracts";
import type { MountDevtoolsRoutesDeps } from "./types";

/**
 * The session view of the development dashboard: there are no accounts, the
 * loopback guard is the access control, and the visitor is an admin.
 */
export function developmentSessionView(deps: MountDevtoolsRoutesDeps): DevtoolsSessionView {
  return {
    mode: "development",
    stage: "active",
    account: null,
    role: "admin",
    csrf: null,
    expiresAt: null,
    instance: deps.instance ?? null,
    methods: null,
    share: null,
    ...readVersions(),
  };
}

/** The tabs `GET api/panels` lists: the built-in tabs in `deps.builtInPanels` (default all), then the package panels. */
export function panelInfos(
  deps: MountDevtoolsRoutesDeps,
  panels: readonly (Pick<MountedDevtoolsPanel, "id" | "title"> &
    Partial<Pick<MountedDevtoolsPanel, "share">>)[],
): DevtoolsPanelInfo[] {
  return listPanelInfos(panels, deps.builtInPanels);
}

/**
 * Registers `GET /api/auth/session` (the development view: signed in as an
 * admin, no accounts) and `GET /api/panels`, so the same dashboard shell
 * works in both modes. Production answers these from its own mount.
 */
export function registerSessionRoutes(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
  panels: readonly MountedDevtoolsPanel[],
): void {
  server.get("/api/auth/session", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");

    return developmentSessionView(deps);
  });

  server.get("/api/panels", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");

    return panelInfos(deps, panels);
  });
}
