/**
 * Token usage a CLI session reported, normalized across vendors.
 *
 * Every field except `input`/`output`/`total` is optional because vendors
 * report different subsets: Claude Code reports cache reads/writes and a
 * USD cost, Codex reports cached and reasoning tokens, Aider reports a
 * cost line, some CLIs report nothing at all.
 *
 * @example
 * const usage: CliUsage = { input: 1200, output: 340, total: 1540, cachedTokens: 800 };
 */
export type CliUsage = {
  /** Input/prompt tokens (includes `cachedTokens` when the vendor counts them together). */
  input: number;
  /** Output/completion tokens. */
  output: number;
  /** `input + output`. */
  total: number;
  /** Input tokens served from the vendor's prompt cache. */
  cachedTokens?: number;
  /** Input tokens written to the vendor's prompt cache. */
  cacheWriteTokens?: number;
  /** Output tokens spent on reasoning, when the vendor reports them. */
  reasoningTokens?: number;
  /** Cost in USD as reported by the CLI itself (never computed by this package). */
  costUSD?: number;
};

/**
 * How a CLI session ended.
 *
 * - `completed` — the process exited 0 and the stream reported no fatal error.
 * - `failed` — non-zero exit, a spawn failure, or a fatal error in the stream.
 * - `cancelled` — the run's `signal` aborted (or `session.cancel()` was called).
 * - `timeout` — `timeoutMs` elapsed and the process tree was killed.
 */
export type CliEndStatus = "completed" | "failed" | "cancelled" | "timeout";

/** A session started; carries the vendor's session/thread id when it reported one. */
export type CliSessionStartedEvent = {
  type: "session.started";
  /** Reference to pass back as `resume` to continue this session. */
  sessionRef?: string;
  /** Model the CLI reported it is using. */
  model?: string;
  /** The vendor's original record, for debugging. */
  raw?: unknown;
};

/**
 * Assistant text. `delta: true` is a streamed fragment of the message being
 * written; `delta: false` is a complete message. `final: true` marks the
 * vendor's own "final answer" record (for example Claude Code's `result`).
 */
export type CliMessageEvent = {
  type: "message";
  text: string;
  delta: boolean;
  final?: boolean;
  raw?: unknown;
};

/** The CLI invoked one of its tools (or an MCP tool). */
export type CliToolCallEvent = {
  type: "tool.call";
  /** Vendor call id, used to pair the call with its `tool.result`. */
  id: string;
  name: string;
  input: unknown;
  raw?: unknown;
};

/** A tool finished. `output` is the tool's text output (stringified when structured). */
export type CliToolResultEvent = {
  type: "tool.result";
  id: string;
  output: string;
  isError: boolean;
  raw?: unknown;
};

/**
 * Token usage. `cumulative: true` replaces the running total (the vendor
 * reported totals for the whole session so far); `cumulative: false` adds
 * to it (the vendor reported one turn).
 */
export type CliUsageEvent = {
  type: "usage";
  usage: CliUsage;
  cumulative: boolean;
  raw?: unknown;
};

/**
 * Something went wrong. `fatal: true` means the vendor reported the run as
 * failed; the session then ends `failed` even when the process exits 0.
 */
export type CliErrorEvent = {
  type: "error";
  message: string;
  fatal?: boolean;
  raw?: unknown;
};

/** The process exited and the stream is drained. Always the last event. */
export type CliSessionEndedEvent = {
  type: "session.ended";
  status: CliEndStatus;
  /** Process exit code; `null` when the process never started or died by signal. */
  exitCode: number | null;
  /** Terminating signal, when the process died by one. */
  signal: string | null;
  sessionRef?: string;
  durationMs: number;
};

/**
 * The unified event model every adapter's stream is reduced to.
 * Discriminate on `type`.
 *
 * @example
 * for await (const event of session.events) {
 *   if (event.type === "message" && event.delta) process.stdout.write(event.text);
 *   if (event.type === "tool.call") console.log("→", event.name, event.input);
 * }
 */
export type CliEvent =
  | CliSessionStartedEvent
  | CliMessageEvent
  | CliToolCallEvent
  | CliToolResultEvent
  | CliUsageEvent
  | CliErrorEvent
  | CliSessionEndedEvent;

/** Events an adapter's stream parser may emit (`session.ended` is emitted by the runner). */
export type CliParsedEvent = Exclude<CliEvent, CliSessionEndedEvent>;
