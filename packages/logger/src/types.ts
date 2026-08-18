/**
 * Severity levels, ordered debug < info ≈ success < warn < error < fatal.
 *
 * - `debug` — verbose dev diagnostics
 * - `info` / `success` — neutral and explicit-completion events (same severity)
 * - `warn` — recoverable concern
 * - `error` — handled failure; the app continues
 * - `fatal` — unrecoverable failure; the app is going down
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "success" | "fatal";

/**
 * Process-level events that `Logger.enableAutoFlush()` can hook to drain
 * buffered channels before the process terminates.
 *
 * - Signals (`SIGINT`, `SIGTERM`, `SIGHUP`, `SIGBREAK`, `SIGUSR2`) are flushed
 *   then re-raised so Node's default exit behavior runs.
 * - `beforeExit` is flushed in place — Node exits on its own afterwards.
 */
export type AutoFlushEvent =
  | "SIGINT"
  | "SIGTERM"
  | "SIGHUP"
  | "SIGBREAK"
  | "SIGUSR2"
  | "beforeExit";

export type DebugMode = "daily" | "monthly" | "yearly" | "hourly";

/**
 * Replacement value used by `RedactConfig`. Either a literal string
 * (e.g. `"[REDACTED]"`) or a function that receives the original value plus
 * the dotted path it sits at and returns whatever should replace it.
 */
export type RedactCensor =
  | string
  | ((value: any, path: string) => any);

/**
 * Strip sensitive fields from log entries before they reach a channel.
 *
 * Two independent matchers, both applied at the same choke point (so every
 * channel inherits them):
 *
 * 1. **Key denylist** (`keys` + the built-in `DEFAULT_REDACT_KEYS`) — matches
 *    by *key name* at any depth, case- and separator-insensitively. **On by
 *    default**, with no configuration: `password`, `authorization`, `apiKey`,
 *    `token`, `cookie`, … are censored out of the box.
 * 2. **Path globs** (`paths`) — opt-in, dotted patterns evaluated against the
 *    `LoggingData` itself (`context.password`, `message.token`). Wildcards:
 *    - `*`  — matches a single segment (any one key)
 *    - `**` — matches zero or more segments (any depth, any key)
 *
 * Configurable in two places:
 *
 * 1. **Logger-wide** via `Logger.configure({ redact })` — applied once before
 *    fan-out. This is the security floor; no channel can undo it.
 * 2. **Per channel** via the channel's options. Channel paths/keys are
 *    *additive*: they extend (never replace) the logger-wide list, so a
 *    channel can only redact more, never less.
 *
 * @example
 * // Nothing to configure for the common secrets — this is the default:
 * log.info("auth", "login", "ok", { password: "hunter2" });
 * // channel sees { password: "[REDACTED]" }
 *
 * @example
 * logger.configure({
 *   redact: {
 *     keys: ["internalRef"], // extends the built-in denylist
 *     paths: ["context.*.token", "context.headers.authorization"],
 *     censor: "[REDACTED]",
 *   },
 * });
 */
export type RedactConfig = {
  /**
   * Glob path patterns to redact. Paths are evaluated against the full
   * `LoggingData` object — so prefix with `context.` or `message.` to scope
   * to either field.
   *
   * Optional: omit it to rely on key-based redaction alone.
   */
  paths?: string[];
  /**
   * Extra key names to censor anywhere they appear, in addition to the
   * built-in {@link DEFAULT_REDACT_KEYS}. Matched case- and
   * separator-insensitively on the normalized key, so `"internal_ref"`,
   * `"internalRef"` and `"INTERNAL-REF"` are one entry.
   */
  keys?: string[];
  /**
   * Set to `false` to drop the built-in secret-key denylist and rely solely
   * on `paths`/`keys`.
   *
   * This is an escape hatch, not a tuning knob — turning it off restores the
   * pre-4.15.0 behavior where a `password` in `context` reaches every sink in
   * cleartext. Prefer narrowing with a function `censor` over disabling.
   *
   * A *channel* may set this to `true` to re-enable defaults the logger-wide
   * config turned off (channels can only redact more, never less); a channel
   * setting it to `false` cannot disable a logger-wide default.
   *
   * @default true
   */
  defaultKeys?: boolean;
  /**
   * Replacement applied at each matched path or key.
   *
   * @default "[REDACTED]"
   */
  censor?: RedactCensor;
};

export type BasicLogConfigurations = {
  /**
   * Set what level of logs should be logged
   *
   * @default all
   */
  levels?: LogLevel[];
  /**
   * Date and time format
   */
  dateFormat?: {
    date?: string;
    time?: string;
  };
  /**
   * Advanced filter to determine if the message should be logged or not
   */
  filter?: (data: LoggingData) => boolean;
  /**
   * Add additional context to the log
   */
  context?: (data: LoggingData) => Promise<Record<string, any>>;
  /**
   * Channel-specific redaction. Additive on top of the logger-wide config —
   * the channel's paths/keys extend (never replace) the logger floor. The
   * `censor` here, when omitted, falls back to the logger-wide censor. The
   * built-in key denylist applies to every channel whether or not this is set.
   */
  redact?: RedactConfig;
};

export type LogMessage = {
  content: string;
  level: LogLevel;
  date: string;
  module: string;
  action: string;
  stack?: string;
  context?: Record<string, any>;
  timestamp?: string;
};

export interface LogContract {
  /**
   * Channel name
   */
  name: string;

  /**
   * Channel description
   */
  description?: string;

  /**
   * Determine if channel is logging in terminal
   */
  terminal?: boolean;

  /**
   * Log the given message
   */
  log(data: LoggingData): void | Promise<void>;

  /**
   * Asynchronously flush buffered logs. Awaited on a graceful shutdown path
   * (`await log.flush()`); implement this on channels whose delivery is async
   * (network transports, async disk writes) where {@link flushSync} cannot
   * wait on the I/O.
   */
  flush?(): void | Promise<void>;

  /**
   * Synchronously flush logs
   */
  flushSync?(): void;
}

export type LoggingData = {
  type: LogLevel;
  module: string;
  action: string;
  message: any;
  context?: Record<string, any>;
};

export type OmittedLoggingData = Omit<LoggingData, "type">;
