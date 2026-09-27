import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Whether `address` is a loopback address. Deliberately reads
 * `request.socket.remoteAddress` rather than `request.ip`, which honours
 * `X-Forwarded-For` when the app trusts a proxy — a header any client can
 * set.
 */
function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

/**
 * Registers the dev-only, loopback-only guard as an `onRequest` hook on
 * `server`. Callers must register this inside an encapsulated Fastify
 * context (a plugin/prefix) so the hook never reaches routes outside the
 * dashboard.
 */
export function registerDevtoolsGuard(
  server: FastifyInstance,
  deps: MountDevtoolsRoutesDeps,
): void {
  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.isDevelopment() || !isLoopbackAddress(request.socket.remoteAddress)) {
      // Returning the reply is what stops the lifecycle in an async hook;
      // without it Fastify still runs the handler after the 404 is sent.
      return reply.code(404).send();
    }
  });
}
