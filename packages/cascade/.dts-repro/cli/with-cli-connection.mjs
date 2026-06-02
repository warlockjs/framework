import { dataSourceRegistry } from "../data-source/data-source-registry.mjs";
import { connectFromEnv } from "./connection-from-env.mjs";
//#region ../../@warlock.js/cascade/src/cli/with-cli-connection.ts
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
async function withCliConnection(handler) {
	await connectFromEnv();
	try {
		return await handler();
	} finally {
		for (const dataSource of dataSourceRegistry.getAllDataSources()) try {
			await dataSource.driver.disconnect();
		} catch {}
	}
}
//#endregion
export { withCliConnection };

//# sourceMappingURL=with-cli-connection.mjs.map