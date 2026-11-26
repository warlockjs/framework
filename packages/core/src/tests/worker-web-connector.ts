/**
 * The web connector inside a worker's test server.
 *
 * The worker's runtime starts every connector except `http`, so the web
 * connector (pages, Vite) has no server to mount on while the runtime boots. The
 * worker's test server owns the HTTP instance, so it starts the connector
 * itself: after the plugins are registered and before the routes are scanned,
 * the same order the development server uses. One connector instance serves the
 * worker, reading the worker's own database.
 *
 * @internal
 */
import { connectorsManager } from "../connectors/connectors-manager";
import type { Connector } from "../connectors/types";
import { container } from "../container";
import type { FastifyInstance } from "../http/server";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";

const WEB_CONNECTOR_NAME = "web";

/**
 * The web connector of this app, or `undefined` when the app has none: the one
 * a spec registered with the connectors manager, else the one `warlock.config.ts`
 * declares.
 */
export function findWebConnector(): Connector | undefined {
  const registered = connectorsManager
    .list()
    .find((connector) => connector.name === WEB_CONNECTOR_NAME);

  if (registered) return registered;
  if (!warlockConfigManager.isLoaded) return undefined;

  const declared: Connector[] = warlockConfigManager.get("connectors") ?? [];

  return declared.find((connector) => connector.name === WEB_CONNECTOR_NAME);
}

/**
 * Boot and start the web connector on `server`.
 *
 * Returns the function that stops it, or `undefined` when the app has no web
 * connector (or it is already serving from an earlier server).
 */
export async function startWebConnectorOn(
  server: FastifyInstance,
  connector: Connector | undefined = findWebConnector(),
): Promise<(() => Promise<void>) | undefined> {
  if (!connector || connector.isActive()) return undefined;

  container.set("http.server", server);

  try {
    await connector.boot();
    await connector.start();
  } catch (error) {
    await connector.shutdown().catch(() => undefined);
    throw error;
  }

  return () => connector.shutdown();
}
