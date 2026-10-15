import { dataSourceRegistry } from "../data-source/data-source-registry";
import { connectFromEnv } from "./connection-from-env";

/**
 * Run a CLI handler with a live data-source connection.
 *
 * Lifecycle:
 * 1. `connectFromEnv()` — register the default data source and open the
 *    driver pool/socket.
 * 2. `handler()` — your command logic.
 * 3. Disconnect every data source in the registry — always runs, including
 *    when the handler throws, so the Node process can exit cleanly.
 *
 * Errors raised by `disconnect()` are swallowed: they would otherwise mask
 * a real error from the handler and there's nothing useful a caller can do
 * once the process is on its way out.
 *
 * @example
 * await withCliConnection(async () => {
 *   await loadMigrations(path);
 *   const results = await runMigrations();
 *   printRunSummary(results);
 * });
 */
export async function withCliConnection<T>(handler: () => Promise<T>): Promise<T> {
  await connectFromEnv();

  try {
    return await handler();
  } finally {
    for (const dataSource of dataSourceRegistry.getAllDataSources()) {
      try {
        await dataSource.driver.disconnect();
      } catch {
        // Suppress — masking the handler's real error would be worse.
      }
    }
  }
}
