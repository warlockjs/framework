import config from "@mongez/config";
import Fastify, { FastifyServerOptions } from "fastify";

export type FastifyInstance = ReturnType<typeof Fastify>;

/**
 * Default Fastify body limit. Kept at the historical 200GB so existing apps
 * don't regress on upgrade. Override via `http.bodyLimit` in config; for
 * per-route caps use the `maxBodySize()` middleware.
 */
const DEFAULT_BODY_LIMIT = 200 * 1024 * 1024 * 1024;

// Instantiate Fastify server
let server: FastifyInstance | undefined = undefined;

export function startHttpServer(options?: FastifyServerOptions): FastifyInstance {
  return (server = Fastify({
    trustProxy: true,
    bodyLimit: config.get("http.bodyLimit", DEFAULT_BODY_LIMIT),
    ...options,
  }));
}

/**
 * Expose the server to be publicly accessible
 */
export function getHttpServer(): FastifyInstance {
  return server;
}
