//#region ../../@warlock.js/core/src/tests/start-http-development-server.d.ts
/**
 * Start the HTTP test server (minimal - no file watching)
 * Call this in Vitest's globalSetup
 */
declare function startHttpTestServer(): Promise<void>;
/**
 * Stop the HTTP test server
 * Call this in Vitest's globalTeardown
 */
declare function stopHttpTestServer(): Promise<void>;
/**
 * Check if test server is running
 */
declare function isTestServerRunning(): boolean;
//#endregion
export { isTestServerRunning, startHttpTestServer, stopHttpTestServer };
//# sourceMappingURL=start-http-development-server.d.mts.map