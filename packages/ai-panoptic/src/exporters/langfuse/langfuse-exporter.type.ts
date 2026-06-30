/**
 * Minimal structural view of the parts of the `langfuse` SDK the
 * exporter actually calls. Declared locally (rather than importing the
 * SDK's own types) so this module type-checks even when `langfuse` is
 * not installed — it is an OPTIONAL peer, lazily imported at runtime.
 * The shape tracks Langfuse SDK v3: a client creates a trace, a trace
 * creates nested `span` / `generation` observations, and the client is
 * drained with `flushAsync` / `shutdownAsync`.
 */
export type LangfuseClientLike = {
  trace(body: LangfuseTraceBody): LangfuseTraceLike;
  flushAsync(): Promise<unknown>;
  shutdownAsync(): Promise<unknown>;
};

/**
 * A Langfuse trace handle — creates nested observations and carries the
 * trace-level metadata Panoptic maps the root span onto.
 */
export type LangfuseTraceLike = {
  span(body: LangfuseObservationBody): LangfuseObservationLike;
  generation(body: LangfuseObservationBody): LangfuseObservationLike;
};

/**
 * A Langfuse observation handle (span or generation) — nests further
 * children and is closed with `end()`.
 */
export type LangfuseObservationLike = {
  span(body: LangfuseObservationBody): LangfuseObservationLike;
  generation(body: LangfuseObservationBody): LangfuseObservationLike;
  end(body?: LangfuseObservationEndBody): unknown;
};

/** Subset of the Langfuse trace-creation body Panoptic populates. */
export type LangfuseTraceBody = {
  id?: string;
  name?: string;
  sessionId?: string;
  version?: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
  /** Root input surfaced at trace level (set only under content capture). */
  input?: unknown;
  /** Root output surfaced at trace level (set only under content capture). */
  output?: unknown;
};

/** Subset of the Langfuse observation-creation body Panoptic populates. */
export type LangfuseObservationBody = {
  id?: string;
  name?: string;
  startTime?: Date;
  endTime?: Date;
  level?: LangfuseObservationLevel;
  statusMessage?: string;
  version?: string;
  usage?: LangfuseUsageBody;
  metadata?: Record<string, unknown>;
  /** Captured input (prompt / tool args), set only under content capture. */
  input?: unknown;
  /** Captured output (completion / tool result), set only under content capture. */
  output?: unknown;
};

/** Body accepted by `observation.end()`. */
export type LangfuseObservationEndBody = {
  endTime?: Date;
  level?: LangfuseObservationLevel;
  statusMessage?: string;
};

/** Langfuse usage block (`input`/`output`/`total` token counts). */
export type LangfuseUsageBody = {
  input?: number;
  output?: number;
  total?: number;
  unit?: "TOKENS";
};

/** Langfuse observation severity levels. */
export type LangfuseObservationLevel = "DEFAULT" | "DEBUG" | "WARNING" | "ERROR";

/**
 * Options for {@link langfuseExporter}.
 *
 * Either pass an already-constructed Langfuse `client`, or pass the
 * credentials and let the exporter construct one lazily (so `langfuse`
 * stays an optional peer that is only imported when this exporter is
 * actually used).
 */
export type LangfuseExporterOptions = {
  /**
   * A pre-built Langfuse client (any object matching
   * {@link LangfuseClientLike}, including a real `Langfuse` instance).
   * When supplied, the exporter never imports the SDK itself.
   */
  client?: LangfuseClientLike;
  /** Langfuse public key — used to construct a client when `client` is omitted. */
  publicKey?: string;
  /** Langfuse secret key — used to construct a client when `client` is omitted. */
  secretKey?: string;
  /** Langfuse host base URL. Optional; defaults to the SDK's own default. */
  baseUrl?: string;
};
