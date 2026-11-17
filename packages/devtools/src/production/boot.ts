import type { FastifyInstance } from "fastify";
import type { MountedDevtoolsPanel } from "../panels";
import type { MountDevtoolsRoutesDeps } from "../server/types";
import type { DevtoolsDisposer, ResolvedDevtoolsOptions } from "../types";

/** What the connector hands production boot. */
export type BootProductionDevtoolsInput = {
  options: ResolvedDevtoolsOptions;
  env: Readonly<Record<string, string | undefined>>;
  server: FastifyInstance;
  /** Package panels loaded with `mode: "production"` (not yet filtered). */
  panels: readonly MountedDevtoolsPanel[];
  /** The route deps the connector builds for development, reused (requestLog, listRoutes, ai, …). */
  routes: Omit<MountDevtoolsRoutesDeps, "collector" | "options" | "isDevelopment">;
  log: {
    info(module: string, action: string, message: string): unknown;
    warn(module: string, action: string, message: string): unknown;
    error(module: string, action: string, message: string): unknown;
  };
};

/**
 * Starts the production monitor, in this order: resolve options (env) →
 * check `encryption.key` (DT006) → cascade store (DT005) → `store.verify()`
 * (DT008) → `ensureFirstAdmin()` (DT003/DT004) → instance info → capture
 * (attach hooks) → resource monitor, health history, jobs reader → local
 * reporter → report writer → shared insights → `excludeFromRequestLog(path)`
 * → mount. Logs one line with the path masked (`/ops-…`), never the full path.
 * Any `DevtoolsProductionConfigError` propagates: the app does not boot.
 *
 * Returns the disposer the connector calls at shutdown (flush samples, stop
 * timers, detach hooks).
 *
 * Owner: WP-3.
 */
export async function bootProductionDevtools(
  _input: BootProductionDevtoolsInput,
): Promise<DevtoolsDisposer> {
  throw new Error("not implemented");
}
