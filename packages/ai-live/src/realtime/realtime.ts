import { generateRunId } from "@warlock.js/ai";
import type {
  RealtimeOptions,
  RealtimeReport,
  RealtimeSession,
} from "../contracts/realtime.contract";

/**
 * Open a live duplex voice session — the stateful primitive of
 * `@warlock.js/ai-live`. Connects through the provided
 * {@link RealtimeOptions.transport} (an OpenAI Realtime WebSocket
 * adapter, a mock in tests), then hands back a {@link RealtimeSession}
 * you drive: push audio/text in, consume the event stream out, and
 * `close()` to end it and receive a `type: "realtime"` report for the
 * cost/observability surfaces.
 *
 * Unlike the one-shot `ai.*` verbs, this returns a long-lived session —
 * its closest sibling is `ai.orchestrator`. Keeping the transport
 * pluggable is what lets the session surface ship without hard-wiring a
 * WebSocket dependency.
 *
 * @example
 * const session = await ai.realtime({ transport, model: "gpt-realtime", voice: "alloy" });
 * session.sendAudio(micChunk, "audio/pcm");
 * for await (const event of session.events()) {
 *   if (event.type === "audio") speaker.write(event.base64);
 * }
 * const report = await session.close();
 */
export async function realtime(options: RealtimeOptions): Promise<RealtimeSession> {
  const runId = generateRunId("realtime");
  const startedAt = new Date().toISOString();
  const startPerf = performance.now();

  const connection = await options.transport.connect({
    model: options.model,
    voice: options.voice,
    instructions: options.instructions,
  });

  let report: RealtimeReport | undefined;

  return {
    sendAudio: (base64, mediaType) => connection.sendAudio(base64, mediaType),
    sendText: (text) => connection.sendText(text),
    events: () => connection.events(),
    async close(): Promise<RealtimeReport> {
      // Idempotent — closing twice returns the first report, never
      // re-tears-down the connection.
      if (report) {
        return report;
      }

      await connection.close();

      report = {
        runId,
        rootRunId: runId,
        type: "realtime",
        name: options.name ?? "realtime",
        status: "completed",
        startedAt,
        endedAt: new Date().toISOString(),
        duration: performance.now() - startPerf,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      };

      return report;
    },
  };
}
