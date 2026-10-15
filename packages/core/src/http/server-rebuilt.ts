import type { FastifyInstance } from "fastify";

/**
 * Called with the NEW Fastify instance after `HttpConnector.restart()` has
 * rebuilt it — before `start()` scans routes and listens, so hooks and plugins
 * added here still land on a server that has not become ready.
 */
export type HttpServerRebuiltListener = (server: FastifyInstance) => void;

const listeners = new Set<HttpServerRebuiltListener>();

/**
 * Subscribe to HTTP server rebuilds (dev HMR restart of the HTTP connector).
 * Not fired for the initial boot — a connector that boots after HTTP already
 * sees that first instance. Returns an unsubscribe function.
 */
export function onHttpServerRebuilt(listener: HttpServerRebuiltListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** @internal Fired by `HttpConnector.restart()`. */
export function notifyHttpServerRebuilt(server: FastifyInstance): void {
  for (const listener of [...listeners]) {
    listener(server);
  }
}
