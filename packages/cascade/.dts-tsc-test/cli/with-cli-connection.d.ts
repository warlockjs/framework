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
export declare function withCliConnection<T>(handler: () => Promise<T>): Promise<T>;
//# sourceMappingURL=with-cli-connection.d.ts.map