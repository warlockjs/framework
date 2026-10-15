import type { AIError } from "@warlock.js/ai";

/**
 * One event streamed out of a realtime voice session. A closed union so
 * consumers can `switch` exhaustively over the duplex output.
 *
 * - `audio` — a chunk of synthesized assistant audio (base64).
 * - `transcript` — an incremental or final transcript line for either side.
 * - `tool-call` — the model requested a tool (wire it like an agent tool).
 * - `error` — a typed, non-fatal provider/transport error.
 * - `done` — the session ended (server-side).
 */
export type RealtimeEvent =
  | { type: "audio"; base64: string; mediaType: string }
  | { type: "transcript"; role: "user" | "assistant"; text: string; final: boolean }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "error"; error: AIError }
  | { type: "done" };

/** Config a {@link RealtimeTransport} needs to open a connection. */
export type RealtimeConnectConfig = {
  /** Realtime model id (e.g. `"gpt-realtime"`). */
  model: string;
  /** Default voice. */
  voice?: string;
  /** System instructions for the session. */
  instructions?: string;
};

/**
 * A live, bidirectional connection to a provider's realtime endpoint —
 * the low-level transport the {@link RealtimeSession} wraps. The first
 * concrete transport is an OpenAI Realtime WebSocket (own adapter); a
 * mock transport drives the tests. Keeping this pluggable is what lets
 * `ai-live` ship the session surface without hard-wiring `ws`.
 */
export interface RealtimeConnection {
  /** Push a chunk of microphone audio (base64) upstream. */
  sendAudio(base64: string, mediaType: string): void;
  /** Push a text message upstream (the model can reply with audio). */
  sendText(text: string): void;
  /** The duplex event stream coming back from the provider. */
  events(): AsyncIterable<RealtimeEvent>;
  /** Tear down the connection. */
  close(): Promise<void>;
}

/** Opens a {@link RealtimeConnection}. Implemented per provider. */
export interface RealtimeTransport {
  connect(config: RealtimeConnectConfig): Promise<RealtimeConnection>;
}

/** Options for {@link ai.realtime}. */
export type RealtimeOptions = {
  /** The provider transport (e.g. an OpenAI Realtime WebSocket adapter). */
  transport: RealtimeTransport;
  /** Realtime model id. */
  model: string;
  /** Default voice. */
  voice?: string;
  /** System instructions for the session. */
  instructions?: string;
  /** Groups this session into a wider request for cost/trace queries. */
  sessionId?: string;
  /** Report node name (defaults to `"realtime"`). */
  name?: string;
};

/**
 * A live duplex voice session — the stateful primitive `ai.realtime()`
 * returns. Push audio/text in, consume {@link RealtimeEvent}s out, and
 * `close()` to end the session and get a report for cost + observability.
 * Its closest sibling is `ai.orchestrator` (a session, not a one-shot).
 */
export interface RealtimeSession {
  /** Push microphone audio (base64) into the session. */
  sendAudio(base64: string, mediaType: string): void;
  /** Push a text turn into the session. */
  sendText(text: string): void;
  /** The duplex event stream (audio / transcript / tool-call / …). */
  events(): AsyncIterable<RealtimeEvent>;
  /** End the session; resolves with the session's report. */
  close(): Promise<RealtimeReport>;
}

/**
 * The report a closed {@link RealtimeSession} produces — a flat
 * `type: "realtime"` node for the trace/cost surfaces. (Realtime usage
 * accounting is provider-dependent and refined as transports land.)
 */
export type RealtimeReport = {
  runId: string;
  rootRunId: string;
  type: "realtime";
  name: string;
  status: "completed" | "failed" | "cancelled";
  startedAt: string;
  endedAt: string;
  duration: number;
  sessionId?: string;
};
