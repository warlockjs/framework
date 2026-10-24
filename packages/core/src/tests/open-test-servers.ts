/**
 * The test HTTP servers a file has opened and not yet closed. Kept apart from
 * `test-http-server.ts` so the lifecycle can close them without importing the
 * HTTP stack.
 */
const openServers = new Set<{ close(): Promise<void> }>();

export function trackOpenTestServer(server: { close(): Promise<void> }): void {
  openServers.add(server);
}

export function forgetOpenTestServer(server: { close(): Promise<void> }): void {
  openServers.delete(server);
}

/**
 * Close every server `createTestHttpServer()` opened that is still open. A
 * worker-scoped runtime calls this between files, so a server a file forgot to
 * close cannot keep its port or routes into the next file.
 */
export async function closeOpenTestHttpServers(): Promise<void> {
  await Promise.all([...openServers].map((server) => server.close().catch(() => undefined)));
}
