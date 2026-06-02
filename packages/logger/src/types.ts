export type LogLevel = "debug" | "info" | "warn" | "error" | "success";

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
 * Paths are dotted glob patterns evaluated against the `LoggingData` itself —
 * use `context.password`, `message.token`, etc. Wildcards:
 *
 * - `*`  — matches a single segment (any one key)
 * - `**` — matches zero or more segments (any depth, any key)
 *
 * Configurable in two places:
 *
 * 1. **Logger-wide** via `Logger.configure({ redact })` — applied once before
 *    fan-out. This is the security floor; no channel can undo it.
 * 2. **Per channel** via the channel's options. Channel paths are *additive*:
 *    they extend (never replace) the logger-wide list, so a channel can only
 *    redact more, never less.
 *
 * @example
 * logger.configure({
 *   redact: {
 *     paths: ["context.password", "context.*.token", "context.headers.authorization"],
 *     censor: "[REDACTED]",
 *   },
 * });
 */
export type RedactConfig = {
  /**
   * Glob path patterns to redact. Paths are evaluated against the full
   * `LoggingData` object — so prefix with `context.` or `message.` to scope
   * to either field.
   */
  paths: string[];
  /**
   * Replacement applied at each matched path.
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
   * the channel's paths extend (never replace) the logger floor. The
   * `censor` here, when omitted, falls back to the logger-wide censor.
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
   * Synchronously flush logs
   */
  flushSync?(): void;
}

export type LoggingData = {
  type: "info" | "debug" | "warn" | "error" | "success";
  module: string;
  action: string;
  message: any;
  context?: Record<string, any>;
};

export type OmittedLoggingData = Omit<LoggingData, "type">;
