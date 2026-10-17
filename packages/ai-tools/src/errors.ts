import { AIError, type AIErrorOptions } from "@warlock.js/ai";

/**
 * Why the calculator rejected an expression.
 *
 * - `"syntax"` — the expression could not be tokenized or parsed
 *   (an unknown character, a misplaced operator, unbalanced parens).
 * - `"divide-by-zero"` — evaluation divided (or took a modulo) by zero.
 * - `"overflow"` — the computed result was not a finite number.
 */
export type CalculatorFailure = "syntax" | "divide-by-zero" | "overflow";

/**
 * Options for {@link CalculatorError} — the structured `type`
 * discriminator so a caller can branch without parsing the message.
 */
export type CalculatorErrorOptions = AIErrorOptions & {
  /** Which class of calculator failure occurred. */
  type: CalculatorFailure;
};

/**
 * The `calculator` tool could not evaluate an expression — it was not
 * valid arithmetic, divided by zero, or overflowed to a non-finite
 * value.
 *
 * **Surface.** Thrown inside the tool handler, where `tool()` wraps it
 * into a `ToolExecutionError` whose message is preserved verbatim and
 * reaches the model as `{ error }` data, so the agent self-corrects
 * rather than crashing. Extends the framework {@link AIError} (category
 * `"tool"` via code `TOOL_EXEC_FAILED`) so it flows through the same
 * typed error contract as every other AI error; branch on `error.type`
 * for the specific failure.
 *
 * @example
 * if (error instanceof CalculatorError && error.type === "divide-by-zero") {
 *   // the expression divided by zero — ask the model to revise it
 * }
 */
export class CalculatorError extends AIError {
  /** Which class of calculator failure occurred. */
  public readonly type: CalculatorFailure;

  public constructor(message: string, options: CalculatorErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "CalculatorError";
    this.type = options.type;
  }
}

/**
 * Why the date-time tool rejected a call.
 *
 * - `"invalid-input"` — a required field for the chosen `op` was
 *   missing or malformed (an unparsable ISO instant, a bad `amount`).
 * - `"invalid-unit"` — `unit` was not one of the supported units.
 * - `"invalid-time-zone"` — the IANA time zone was not recognized.
 * - `"unsupported-op"` — the `op` was not one this tool implements.
 */
export type DateTimeFailure =
  | "invalid-input"
  | "invalid-unit"
  | "invalid-time-zone"
  | "unsupported-op";

/**
 * Options for {@link DateTimeError} — the structured `type`
 * discriminator so a caller can branch without parsing the message.
 */
export type DateTimeErrorOptions = AIErrorOptions & {
  /** Which class of date-time failure occurred. */
  type: DateTimeFailure;
};

/**
 * The `date_time` tool could not complete a call — a required field was
 * missing or malformed, the unit/time zone was unrecognized, or the
 * operation is unsupported.
 *
 * **Surface.** Thrown inside the tool handler, where `tool()` wraps it
 * into a `ToolExecutionError` whose message reaches the model as
 * `{ error }` data so the agent self-corrects. Extends the framework
 * {@link AIError} (category `"tool"` via code `TOOL_EXEC_FAILED`); branch
 * on `error.type` for the specific failure.
 *
 * @example
 * if (error instanceof DateTimeError && error.type === "invalid-unit") {
 *   // the model passed an unknown unit — re-prompt with the allowed set
 * }
 */
export class DateTimeError extends AIError {
  /** Which class of date-time failure occurred. */
  public readonly type: DateTimeFailure;

  public constructor(message: string, options: DateTimeErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "DateTimeError";
    this.type = options.type;
  }
}

/**
 * Why an MCP transport operation failed.
 *
 * - `"connect"` — the transport could not be opened (child process
 *   failed to spawn, HTTP endpoint unreachable) or the `initialize`
 *   handshake failed.
 * - `"protocol"` — a malformed / unexpected JSON-RPC message, a
 *   response that matched no in-flight request, or a missing field.
 * - `"timeout"` — a request exceeded its per-call deadline.
 * - `"closed"` — the transport was used after it was closed, or the
 *   peer closed it mid-call.
 */
export type McpTransportFailure = "connect" | "protocol" | "timeout" | "closed";

/**
 * Options for {@link McpTransportError} — the structured `type`
 * discriminator plus an optional JSON-RPC method name for branchable
 * diagnostics without parsing the message.
 */
export type McpTransportErrorOptions = AIErrorOptions & {
  /** Which class of transport failure occurred. */
  type: McpTransportFailure;
  /** The JSON-RPC method in flight when the failure occurred, if any. */
  method?: string;
};

/**
 * The MCP client's transport layer failed — it could not connect, the
 * peer spoke malformed JSON-RPC, a call timed out, or the transport was
 * already closed.
 *
 * **Surface.** Connection / handshake failures surface at
 * agent-construction time (the caller `await`s `client.tools()`). A
 * `tools/call` failure raised mid-run is wrapped by `tool()` into a
 * `ToolExecutionError` and reaches the model as `{ error }` data, so the
 * agent self-corrects rather than crashing. Extends the framework
 * {@link AIError} (category `"tool"`, code `TOOL_EXEC_FAILED`) so it
 * flows through the same typed error contract as every other AI error;
 * branch on `error.type` for the specific failure.
 *
 * @example
 * if (error instanceof McpTransportError && error.type === "timeout") {
 *   // the remote call exceeded its deadline — retry or escalate
 * }
 */
export class McpTransportError extends AIError {
  /** Which class of transport failure occurred. */
  public readonly type: McpTransportFailure;
  /** The JSON-RPC method in flight when the failure occurred, if any. */
  public readonly method?: string;

  public constructor(message: string, options: McpTransportErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "McpTransportError";
    this.type = options.type;
    this.method = options.method;
  }
}

/**
 * Why `ai.mcp.serve` refused to build or start a server.
 *
 * - `"config"` — invalid serve options: a non-loopback HTTP bind without
 *   `auth`, an empty bearer token, a bad `path` / `port`, or
 *   `prefixToolNames` without a grouped source.
 * - `"collision"` — two exposed tools (or resources / prompts) share a
 *   name (URI for resources).
 * - `"listen"` — the HTTP server could not bind (port in use, permission
 *   denied, unknown host).
 */
export type McpServeFailure = "config" | "collision" | "listen";

/**
 * Options for {@link McpServeError} — the structured `type` discriminator.
 */
export type McpServeErrorOptions = AIErrorOptions & {
  /** Which class of serve failure occurred. */
  type: McpServeFailure;
};

/**
 * `ai.mcp.serve` could not build or start the server. Thrown by `serve()`
 * itself for an invalid source or a name collision, and by `start()` for
 * transport configuration and bind failures — never for a single bad request, which gets an HTTP / JSON-RPC
 * error response instead. Extends {@link AIError} (code `TOOL_EXEC_FAILED`);
 * branch on `error.type`.
 *
 * @example
 * if (error instanceof McpServeError && error.type === "collision") {
 *   // two tools share a name — rename one or use a grouped source + prefixToolNames
 * }
 */
export class McpServeError extends AIError {
  /** Which class of serve failure occurred. */
  public readonly type: McpServeFailure;

  public constructor(message: string, options: McpServeErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "McpServeError";
    this.type = options.type;
  }
}

/**
 * Why a web tool (`ai.tools.webSearch` / `ai.tools.fetchUrl`) failed
 * before or during a network call.
 *
 * - `"missing-peer"` — an optional peer dependency the chosen mode needs
 *   (`@mozilla/readability` + `jsdom` for text/markdown extraction, a
 *   search provider SDK) is not installed. The message carries a curated
 *   `npm install` string for the developer.
 * - `"missing-key"` — no API key was supplied via options or the
 *   provider's environment variable.
 * - `"denied-host"` — the requested URL (or a redirect target) was
 *   refused by the outbound policy: a host outside the configured
 *   `allowHosts` allowlist, or a private / loopback / link-local /
 *   cloud-metadata address blocked by the default private-network deny
 *   (an SSRF guardrail).
 * - `"invalid-url"` — the supplied URL could not be parsed, or used a
 *   non-`http(s)` scheme.
 * - `"request-failed"` — the network call itself failed (DNS, connection
 *   reset, timeout) or the provider returned a non-OK status.
 */
export type WebToolFailure =
  | "missing-peer"
  | "missing-key"
  | "denied-host"
  | "invalid-url"
  | "request-failed";

/**
 * Options for {@link WebToolError} — the structured `type` discriminator
 * so a caller can branch without parsing the message.
 */
export type WebToolErrorOptions = AIErrorOptions & {
  /** Which class of web-tool failure occurred. */
  type: WebToolFailure;
};

/**
 * A web tool failed — a missing optional peer, an absent API key, a host
 * rejected by the `allowHosts` guardrail, an unparseable URL, or a failed
 * network call.
 *
 * **Surface.** Thrown from inside a tool's `execute`, so the framework's
 * `tool()` wrapper catches it and surfaces it in the returned `{ error }`
 * field (`invoke()` never throws) — the agent reads the failure as data
 * and self-corrects rather than crashing. Extends the framework
 * {@link AIError} (category `"tool"` via code `TOOL_EXEC_FAILED`) so it
 * flows through the same typed error contract as every other AI error;
 * branch on `error.type` for the specific failure.
 *
 * @example
 * const { error } = await fetchTool.invoke({ url: "http://evil.test" });
 * if (error instanceof WebToolError && error.type === "denied-host") {
 *   // the host was not in allowHosts — surfaced before any network call
 * }
 */
export class WebToolError extends AIError {
  /** Which class of web-tool failure occurred. */
  public readonly type: WebToolFailure;

  public constructor(message: string, options: WebToolErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "WebToolError";
    this.type = options.type;
  }
}

/**
 * Why an `http_request` call was rejected by its own guardrails, before
 * the network request was ever issued.
 *
 * - `"method-not-allowed"` — the model requested an HTTP method that is
 *   not on the tool's `allowMethods` allowlist (defaults to `["GET"]`).
 * - `"host-not-allowed"` — the resolved request host (or a redirect
 *   target) was refused by the outbound policy: not on the tool's
 *   `allowHosts` allowlist, or a private / loopback / link-local /
 *   cloud-metadata address blocked by the default private-network deny
 *   (an SSRF guardrail).
 * - `"invalid-url"` — the supplied URL (or its join with `baseUrl`)
 *   could not be parsed into an absolute `http(s)` URL.
 */
export type HttpPolicyFailure = "method-not-allowed" | "host-not-allowed" | "invalid-url";

/**
 * Options for {@link HttpPolicyError} — the structured `type`
 * discriminator so a caller can branch without parsing the message.
 */
export type HttpPolicyErrorOptions = AIErrorOptions & {
  /** Which class of policy rejection occurred. */
  type: HttpPolicyFailure;
};

/**
 * The `http_request` tool refused a call its construction-time policy
 * does not permit — a disallowed method, a host outside the allowlist,
 * or an unparseable URL. The rejection happens *before* any network
 * request, so a guarded tool can never be coaxed into reaching an
 * off-allowlist host (an SSRF guardrail).
 *
 * **Surface.** Thrown from inside the tool's `execute`, so the framework's
 * `tool()` wrapper catches it and surfaces it in the returned `{ error }`
 * field (`invoke()` never throws) — the agent reads the typed failure as
 * data and self-corrects rather than crashing. Extends the framework
 * {@link AIError} (category `"tool"` via code `TOOL_EXEC_FAILED`) so it
 * flows through the same typed error contract as every other AI error;
 * branch on `error.type` for the specific failure.
 *
 * @example
 * const { error } = await httpTool.invoke({ url: "https://evil.test" });
 * if (error instanceof HttpPolicyError && error.type === "host-not-allowed") {
 *   // the model tried to reach a host outside the configured allowlist
 * }
 */
export class HttpPolicyError extends AIError {
  /** Which class of policy rejection occurred. */
  public readonly type: HttpPolicyFailure;

  public constructor(message: string, options: HttpPolicyErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "HttpPolicyError";
    this.type = options.type;
  }
}
