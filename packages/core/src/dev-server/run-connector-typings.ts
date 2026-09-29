import type { Connector } from "../connectors/types";
import { runTypingsContributions } from "../production/build-contributions";
import type { NamedApiRoute } from "../router/types";
import { warlockPath } from "../utils";
import type { ResolvedBuildConfig } from "../production/resolve-build-config";

export type ConnectorTypingsInput = {
  connectors: readonly Connector[];
  appRoot: string;
  /** Resolved lazily: an app with no typings hook never needs a loaded build config. */
  options(): ResolvedBuildConfig;
  /** Fresh registration-only named API route snapshot (a child process in production). */
  collectRoutes(): Promise<readonly NamedApiRoute[]>;
};

/**
 * Let connectors write their own typings during `warlock generate.typings`.
 *
 * Core cannot import web, so this drains the `typings` hook of each connector's
 * `build` contribution — the seam `warlock build` reads. The named API snapshot
 * (a child process) is collected only when a hook exists AND the web connector
 * is configured, exactly as the builder does; an API-only app pays nothing and
 * cannot fail here.
 */
export async function runConnectorTypings({
  connectors,
  appRoot,
  options,
  collectRoutes,
}: ConnectorTypingsInput): Promise<void> {
  if (!connectors.some((connector) => Boolean(connector.build?.typings))) return;

  const namedApiRoutes = connectors.some((connector) => connector.name === "web")
    ? await collectRoutes()
    : undefined;

  await runTypingsContributions(connectors, {
    productionDir: warlockPath("production"),
    appRoot,
    options: options(),
    namedApiRoutes,
  });
}
