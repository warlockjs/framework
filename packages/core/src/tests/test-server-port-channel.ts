/**
 * The channel `startHttpTestServer` uses to tell test workers which port it
 * bound.
 *
 * Vitest runs `globalSetup` in the main process and each test file in its own
 * worker, so the workers do not share the main process's resolved config — they
 * re-resolve `http.port` from `.env`. An environment variable is the one thing a
 * worker inherits from the process that spawned it, which makes it the only
 * channel an explicit port can travel through.
 *
 * This is process plumbing between two of our own processes, not application
 * configuration — app code still reads its port through `config`.
 */
export const TEST_SERVER_PORT_ENV_KEY = "WARLOCK_TEST_SERVER_PORT";

/**
 * Publish the port the test server bound, for the workers to read.
 */
export function publishTestServerPort(port: number): void {
  process.env[TEST_SERVER_PORT_ENV_KEY] = String(port);
}

/**
 * Withdraw the published port on shutdown, so a later run in the same process
 * can't inherit a stale one.
 */
export function withdrawTestServerPort(): void {
  delete process.env[TEST_SERVER_PORT_ENV_KEY];
}
