import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { log } from "@warlock.js/logger";
import { createPublicErrorDescriber, type ServePublicError } from "./public-error";
import { ServeHttpError } from "./serve-http-error";
import { encodeSSE } from "./sse";
import { streamToSSE, type StreamLike, type StreamToSSEOptions } from "./stream-to-sse";

/**
 * Anything `serve` can expose: a primitive whose `stream(input, options)`
 * returns a {@link StreamLike}. Agents, supervisors, and orchestrators all
 * satisfy it.
 */
export type ServableExecutable<TInput = unknown> = {
  stream(input: TInput, options?: Record<string, unknown>): StreamLike<{ type: string }, unknown>;
};

/** One event of the served stream, as handed to an `events` function. */
export type ServeStreamEvent = { type: string } & Record<string, unknown>;

/**
 * Which stream events reach the client, and in what shape.
 *
 * - `"safe"` (default) — text deltas and completion / error markers only,
 *   each reduced to `{ type, delta }`, `{ type }` or `{ type, error }` (see
 *   the serve docs for the list). Tool calls, reasoning, usage, trip
 *   records and raw error details are not sent.
 * - `"all"` — every event verbatim, and raw error messages in `error`
 *   frames. For trusted internal consumers only.
 * - `string[]` — the listed event types, verbatim.
 * - a function — return the frame data for an event, or `undefined` to
 *   drop it.
 */
export type ServeEventFilter =
  | "safe"
  | "all"
  | readonly string[]
  | ((event: ServeStreamEvent) => unknown);

/** Options for {@link serve}. */
export type ServeOptions<TInput = unknown> = {
  /**
   * Bearer token required on every request. When set, a request must send
   * `Authorization: Bearer <token>`, else `401`. Fold this in (or
   * `authorize`) for a production deploy.
   */
  authToken?: string;
  /**
   * Decide from the request whether it may run (session cookie, signed
   * header, upstream identity). Return `false` to answer `401`; throw a
   * {@link ServeHttpError} for another status. Runs after `authToken`.
   */
  authorize?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /**
   * Declare the endpoint deliberately open. Without `authToken`,
   * `authorize` or `public: true`, `serve` logs a one-time warning when
   * `NODE_ENV` is `production`.
   */
  public?: boolean;
  /**
   * Map the parsed JSON request body to the executable's input. Default:
   * `body.input`, which must be a string (else `400 invalid_input`).
   * Override to accept a different request shape; throw a
   * {@link ServeHttpError} to refuse a body.
   */
  toInput?: (body: Record<string, unknown>) => TInput;
  /**
   * Maximum length, in characters, of a string input. Longer input is
   * refused with `413 input_too_large` before the run starts. Default: no
   * limit beyond `maxBodyBytes`.
   */
  maxInputChars?: number;
  /**
   * Add extra per-call stream options from the trusted request context.
   * Default: none. `sessionId`, `history` and `signal` are always set by
   * the server (from `session`) and override anything returned here — a
   * client can never supply them through the request body.
   */
  toOptions?: (context: ServeRequestContext) => Record<string, unknown>;
  /** Server-owned conversation state. Defaults to a fresh ID and no history. */
  session?: ServeSessionOptions;
  /** Maximum accepted JSON request size in bytes. Defaults to 1 MiB. */
  maxBodyBytes?: number;
  /**
   * Maximum runs in flight at once for this handler. A request over the
   * limit is answered `503 { "error": "busy" }`. Default: no limit.
   */
  maxConcurrent?: number;
  /** Which stream events reach the client. Default `"safe"`. See {@link ServeEventFilter}. */
  events?: ServeEventFilter;
  /**
   * Map the final result to the `result` frame. Default: `{ text, data,
   * error }`, where `error` is `{ code, message, reference }` with a fixed
   * message (the full error is logged under `reference`). Pass
   * `(result) => result` to send the whole result, report included.
   */
  toResult?: (result: unknown) => unknown;
};

/** Trusted request data available while configuring a served execution. */
export type ServeRequestContext = {
  req: IncomingMessage;
  sessionId: string;
  history: unknown;
  signal: AbortSignal;
};

/** Server-side sources for per-request session state. May be async. */
export type ServeSessionOptions = {
  createId?: (req: IncomingMessage) => string | Promise<string>;
  loadHistory?: (context: Pick<ServeRequestContext, "req" | "sessionId">) => unknown;
};

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

const LOG_MODULE = "ai.serve";

/** Whether the production warning for an unauthenticated handler was logged. */
let warnedOpenEndpoint = false;

class BodyTooLargeError extends Error {
  override name = "BodyTooLargeError";
}

class ClientDisconnectedError extends Error {
  override name = "ClientDisconnectedError";
}

type Describe = (error: unknown) => ServePublicError;

type SafeProjection = (event: ServeStreamEvent, describe: Describe) => unknown;

const typeOnly: SafeProjection = (event) => ({ type: event.type });
const deltaOnly: SafeProjection = (event) => ({ type: event.type, delta: event.delta });
const errorOnly: SafeProjection = (event, describe) => ({
  type: event.type,
  error: describe(event.error),
});

/**
 * The default (`"safe"`) event set: the text the user is meant to read, and
 * when the run ended. Everything else is internal trace.
 */
const SAFE_EVENTS: ReadonlyMap<string, SafeProjection> = new Map([
  ["agent.trip.streaming", deltaOnly],
  ["agent.completed", typeOnly],
  ["agent.error", errorOnly],
  ["supervisor.agent.streaming", deltaOnly],
  ["supervisor.ack.streaming", deltaOnly],
  ["supervisor.completed", typeOnly],
  ["supervisor.error", errorOnly],
  ["orchestrator.turn.streaming", deltaOnly],
  ["orchestrator.turn.completed", typeOnly],
  ["orchestrator.turn.failed", typeOnly],
]);

/**
 * Turn an executable into a `node:http` request handler that streams its
 * run to the client as Server-Sent Events (A3) — the production-serving
 * primitive. POST a JSON body (`{ input }`, capped by `maxBodyBytes`); the
 * response is an `text/event-stream` of the primitive's client-safe events
 * (`events`), the final `result` (`toResult`), then `[DONE]`. Absorbs the
 * auth-token control; pair with a `sessionLock` + an orchestrator for
 * durable multi-turn serving.
 *
 * @example
 * import { createServer } from "node:http";
 * createServer(ai.serve(myAgent, { authToken: process.env.TOKEN })).listen(8787);
 */
export function serve<TInput = unknown>(
  executable: ServableExecutable<TInput>,
  options: ServeOptions<TInput> = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const toInput = options.toInput ?? defaultToInput<TInput>;
  const toOptions = options.toOptions ?? (() => ({}));
  const maxBodyBytes =
    normalizeLimit("maxBodyBytes", options.maxBodyBytes) ?? DEFAULT_MAX_BODY_BYTES;
  const maxInputChars = normalizeLimit("maxInputChars", options.maxInputChars);
  const maxConcurrent = normalizeLimit("maxConcurrent", options.maxConcurrent);
  const rawErrors = options.events === "all";
  let inFlight = 0;

  warnIfOpen(options);

  return function handle(req: IncomingMessage, res: ServerResponse): void {
    const describe = createPublicErrorDescriber();
    const controller = new AbortController();
    let counted = false;
    let removeDisconnectListeners = () => {};

    void (async () => {
      try {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "method_not_allowed" });
          return;
        }

        if (
          options.authToken &&
          !hasValidBearerToken(req.headers.authorization, options.authToken)
        ) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }

        if (options.authorize && !(await options.authorize(req))) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }

        if (maxConcurrent !== undefined && inFlight >= maxConcurrent) {
          sendJson(res, 503, { error: "busy" });
          return;
        }

        inFlight += 1;
        counted = true;

        const abortForDisconnect = () => {
          if (!controller.signal.aborted) controller.abort(new ClientDisconnectedError());
        };
        const onResponseClose = () => {
          if (!res.writableEnded) abortForDisconnect();
        };
        req.once("aborted", abortForDisconnect);
        res.once("close", onResponseClose);
        removeDisconnectListeners = () => {
          req.removeListener("aborted", abortForDisconnect);
          res.removeListener("close", onResponseClose);
        };

        let body: Record<string, unknown>;
        try {
          body = await readJsonBody(req, maxBodyBytes, controller.signal);
        } catch (error) {
          if (controller.signal.aborted || error instanceof ClientDisconnectedError) return;
          sendJson(res, error instanceof BodyTooLargeError ? 413 : 400, {
            error: error instanceof BodyTooLargeError ? "payload_too_large" : "invalid_json",
          });
          return;
        }

        if (controller.signal.aborted) return;

        const input = toInput(body);

        if (
          maxInputChars !== undefined &&
          typeof input === "string" &&
          input.length > maxInputChars
        ) {
          throw new ServeHttpError(413, "input_too_large", "input exceeds maxInputChars");
        }

        const sessionId = (await options.session?.createId?.(req)) ?? randomUUID();
        const history: unknown = await options.session?.loadHistory?.({ req, sessionId });
        const context: ServeRequestContext = { req, sessionId, history, signal: controller.signal };
        const streamOptions = {
          ...toOptions(context),
          sessionId,
          history,
          signal: controller.signal,
        };

        if (controller.signal.aborted) return;

        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          ...SECURITY_HEADERS,
        });

        const stream = executable.stream(input, streamOptions);
        const frames = streamToSSE(stream, sseProjections(options, describe));

        for await (const frame of frames) {
          if (controller.signal.aborted) break;
          res.write(frame);
        }
      } catch (error) {
        if (!controller.signal.aborted) failRequest(res, error, rawErrors, describe);
      } finally {
        removeDisconnectListeners();
        if (counted) inFlight -= 1;
        if (res.headersSent && !res.writableEnded && !controller.signal.aborted) res.end();
      }
    })();
  };
}

/** Default `toInput`: `body.input`, which must be a string. */
function defaultToInput<TInput>(body: Record<string, unknown>): TInput {
  if (typeof body.input !== "string") {
    throw new ServeHttpError(400, "invalid_input", "body.input must be a string");
  }

  return body.input as TInput;
}

/** The `streamToSSE` projections for the configured `events` / `toResult`. */
function sseProjections(
  options: Pick<ServeOptions, "events" | "toResult">,
  describe: Describe,
): StreamToSSEOptions<{ type: string }, unknown> {
  const events = options.events ?? "safe";
  const mapResult = options.toResult ?? ((result: unknown) => safeResult(result, describe));

  if (events === "all") {
    return { mapResult };
  }

  const mapError = (error: unknown) => ({ error: describe(error) });

  if (events === "safe") {
    return {
      mapEvent: (event) => {
        const project = SAFE_EVENTS.get(event.type);

        return project ? project(event as ServeStreamEvent, describe) : undefined;
      },
      mapResult,
      mapError,
    };
  }

  if (typeof events === "function") {
    return { mapEvent: (event) => events(event as ServeStreamEvent), mapResult, mapError };
  }

  const allowed = new Set(events);

  return {
    mapEvent: (event) => (allowed.has(event.type) ? event : undefined),
    mapResult,
    mapError,
  };
}

/**
 * The default `result` frame: the answer (`text`, `data`) and a public
 * error. The run report (system prompt, tool records, usage) is left out.
 */
function safeResult(result: unknown, describe: Describe): unknown {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return result;
  }

  const record = result as Record<string, unknown>;
  const projected: Record<string, unknown> = {};

  if (typeof record.text === "string") projected.text = record.text;
  if (record.data !== undefined) projected.data = record.data;
  if (record.error !== undefined && record.error !== null) projected.error = describe(record.error);

  return projected;
}

/**
 * Answer a request whose handling threw. Before the stream starts: the
 * status of a {@link ServeHttpError}, else `500 internal_error`. After: an
 * SSE `error` frame (raw message only with `events: "all"`).
 */
function failRequest(
  res: ServerResponse,
  error: unknown,
  rawErrors: boolean,
  describe: Describe,
): void {
  if (res.writableEnded || res.destroyed) return;

  if (!res.headersSent) {
    if (error instanceof ServeHttpError) {
      sendJson(res, error.status, { error: error.code });
      return;
    }

    describe(error);
    sendJson(res, 500, { error: "internal_error" });
    return;
  }

  res.write(
    encodeSSE({
      event: "error",
      data: rawErrors
        ? { message: error instanceof Error ? error.message : String(error) }
        : { error: describe(error) },
    }),
  );
}

/** Log once per process when a production handler has no auth and is not declared public. */
function warnIfOpen(options: Pick<ServeOptions, "authToken" | "authorize" | "public">): void {
  if (warnedOpenEndpoint || process.env.NODE_ENV !== "production") return;
  if (options.authToken || options.authorize || options.public === true) return;

  warnedOpenEndpoint = true;
  log.warn(
    LOG_MODULE,
    "auth.missing",
    "ai.serve has no authToken or authorize option, so anyone who can reach the endpoint can run it and spend provider credits; set authToken or authorize, or public: true if it is meant to be open",
  );
}

/** Read a bounded JSON object request body. */
function readJsonBody(
  req: IncomingMessage,
  maxBodyBytes: number,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBodyBytes) {
        rejectOnce(new BodyTooLargeError());
        req.resume();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const value: unknown =
          chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (value === null || Array.isArray(value) || typeof value !== "object") {
          throw new TypeError("JSON request body must be an object");
        }
        resolve(value as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error) => rejectOnce(error);
    const onAbort = () => rejectOnce(new ClientDisconnectedError());

    if (signal.aborted || req.aborted) {
      onAbort();
      return;
    }

    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Validate an optional non-negative integer limit option. */
function normalizeLimit(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function hasValidBearerToken(authorization: string | undefined, token: string): boolean {
  if (authorization === undefined) return false;
  const actual = Buffer.from(authorization, "utf8");
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}
