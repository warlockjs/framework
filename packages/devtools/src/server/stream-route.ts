import type { FastifyInstance } from "fastify";
import type { DevtoolsStreamSession, MountDevtoolsRoutesDeps } from "./types";
import type { DevtoolsLogEntry, DevtoolsStreamEvent } from "../types";

const PING_INTERVAL_MS = 15_000;

/** How long a browser waits before it reconnects a dropped stream. */
const RETRY_MS = 5000;

/** The log entry as the production stream sends it: no context (it may hold values). */
function withoutContext(entry: DevtoolsLogEntry): DevtoolsLogEntry {
  return {
    level: entry.level,
    module: entry.module,
    action: entry.action,
    message: entry.message,
    at: entry.at,
  };
}

/**
 * Registers the SSE stream: one `event: <type>\ndata: <json>\n\n` frame per
 * collector event, plus a `: ping` comment every 15s to keep intermediaries
 * from closing an idle connection. The reply is hijacked so Fastify never
 * tries to serialize or close the response itself.
 *
 * The first frames are `retry: 5000` and an `event: hello` with the mode,
 * instance and role. In production (`deps.streamSession` set) the session and
 * the open state are checked again at every ping and the stream ends when
 * either fails; log entries carry no context; mail, AI and agent events flow
 * only when those tabs are enabled.
 */
export function registerStreamRoute(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.get("/api/stream", async (request, reply) => {
    // Opening first, so a refused stream (`stream.too-many`) is a normal JSON error.
    const session: DevtoolsStreamSession | null = deps.streamSession
      ? await deps.streamSession(request)
      : null;
    const enabled = new Set(deps.builtInPanels ?? []);
    const instanceId = deps.instance?.id;
    const mode = deps.mode ?? "development";

    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      ...session?.headers,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const write = (frame: string): void => {
      if (!res.writableEnded && !res.destroyed) res.write(frame);
    };

    write(`retry: ${RETRY_MS}\n\n`);

    const hello: Extract<DevtoolsStreamEvent, { type: "hello" }>["data"] = {
      mode,
      instance: instanceId ?? null,
      role: session?.role ?? (mode === "development" ? "admin" : null),
    };

    write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);

    const dispose = deps.collector.subscribe((event) => {
      if (event.type === "hello") return;

      if (session !== null) {
        if (event.type === "mail" && !enabled.has("mail")) return;

        if (event.type === "log") {
          if (!session.logLevels.includes(event.data.level)) return;

          const row = withoutContext(event.data);

          write(
            `event: log\ndata: ${JSON.stringify(instanceId !== undefined ? { ...row, instance: instanceId } : row)}\n\n`,
          );
          return;
        }
      }

      const data =
        event.type === "request" && instanceId !== undefined
          ? { ...event.data, instance: instanceId }
          : event.data;

      write(`event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
    });

    const aiAllowed = session === null || enabled.has("ai");
    const agentsAllowed = session === null || enabled.has("agents");

    const disposeAi =
      aiAllowed && deps.ai?.available
        ? deps.ai.subscribe((event) => {
            write(`event: ai\ndata: ${JSON.stringify(event)}\n\n`);
          })
        : undefined;

    const disposeAgentTraces = agentsAllowed
      ? deps.agentTraces?.subscribe((event) => {
          write(`event: agent-trace\ndata: ${JSON.stringify(event)}\n\n`);
        })
      : undefined;

    let closed = false;

    const close = (): void => {
      if (closed) return;

      closed = true;
      clearInterval(pingTimer);
      dispose();
      disposeAi?.();
      disposeAgentTraces?.();
      session?.release();

      if (!res.writableEnded && !res.destroyed) res.end();
    };

    const pingTimer = setInterval(() => {
      if (session === null) {
        write(": ping\n\n");
        return;
      }

      session.revalidate().then(
        (stillValid) => {
          if (closed) return;

          if (stillValid) write(": ping\n\n");
          else close();
        },
        () => close(),
      );
    }, PING_INTERVAL_MS);
    pingTimer.unref();

    request.raw.on("close", close);
    res.on("error", close);
  });
}
