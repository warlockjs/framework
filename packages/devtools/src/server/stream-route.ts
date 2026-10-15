import type { FastifyInstance } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

const PING_INTERVAL_MS = 15_000;

/**
 * Registers the SSE stream: one `event: <type>\ndata: <json>\n\n` frame per
 * collector event, plus a `: ping` comment every 15s to keep intermediaries
 * from closing an idle connection. The reply is hijacked so Fastify never
 * tries to serialize or close the response itself.
 */
export function registerStreamRoute(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.get("/api/stream", async (request, reply) => {
    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });

    const dispose = deps.collector.subscribe((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });

    const pingTimer = setInterval(() => res.write(": ping\n\n"), PING_INTERVAL_MS);
    pingTimer.unref();

    request.raw.on("close", () => {
      clearInterval(pingTimer);
      dispose();
    });
  });
}
