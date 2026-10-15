import { Random } from "@mongez/reinforcements";
import type { LogChannel } from "./log-channel";
import { applyRedact, mergeRedact } from "./redact";
import type {
  AutoFlushEvent,
  LoggingData,
  LogLevel,
  OmittedLoggingData,
  RedactConfig,
} from "./types";
import { clearMessage } from "./utils/clear-message";

const SIGNAL_EVENTS: ReadonlySet<AutoFlushEvent> = new Set([
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGBREAK",
  "SIGUSR2",
]);

/**
 * Severity ranks used by `setMinLevel`. Higher number = more severe. The
 * ordering matches conventional log-level hierarchies: `debug` is noisiest
 * and easiest to drop; `error` is the loudest and never dropped by the
 * minimum-level filter. `success` sits beside `info` — it's an informational
 * outcome, not a warning.
 */
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export class Logger {
  /**
   * Current channel
   */
  public channels: LogChannel[] = [];

  public id = "logger-" + Random.string(32);

  /**
   * Registered auto-flush handlers, keyed by event name. Stored so repeated
   * calls to `enableAutoFlush` replace rather than stack, and so
   * `disableAutoFlush` can remove them cleanly.
   */
  private autoFlushHandlers = new Map<AutoFlushEvent, () => void>();

  /**
   * Logger-wide minimum severity. When set, entries below this level are
   * dropped before any channel is invoked — cheaper than per-channel `levels`
   * filters because the fan-out loop is skipped entirely. `undefined` means
   * no minimum (every entry reaches every channel that accepts it).
   */
  private minLevel?: LogLevel;

  /**
   * Logger-wide redaction floor. Applied once before fan-out — every
   * channel receives an entry with these paths already censored. Channel
   * configs can extend the path list (additive); they cannot remove paths
   * set here.
   */
  private redactConfig?: RedactConfig;

  /**
   * Add a new channel
   */
  public addChannel(channel: LogChannel) {
    this.channels.push(channel);

    return this;
  }

  /**
   * Set base configurations
   */
  public configure(config: {
    channels?: LogChannel[];
    autoFlushOn?: AutoFlushEvent[];
    minLevel?: LogLevel;
    redact?: RedactConfig;
  }) {
    if (config.channels) {
      this.channels = config.channels;
    }

    if (config.autoFlushOn) {
      this.enableAutoFlush(config.autoFlushOn);
    }

    if (config.minLevel !== undefined) {
      this.setMinLevel(config.minLevel);
    }

    if (config.redact !== undefined) {
      this.setRedact(config.redact);
    }

    return this;
  }

  /**
   * Set the logger-wide redaction floor. Applied to every entry before
   * fan-out; channel configs add more paths on top, never fewer. Pass
   * `undefined` to clear.
   *
   * @example
   * log.setRedact({
   *   paths: ["context.password", "context.*.token"],
   *   censor: "[REDACTED]",
   * });
   */
  public setRedact(config: RedactConfig | undefined): this {
    this.redactConfig = config;
    return this;
  }

  /**
   * Read the active logger-wide redact config (or `undefined`).
   */
  public getRedact(): RedactConfig | undefined {
    return this.redactConfig;
  }

  /**
   * Drop every entry whose severity is below `level` before fan-out. Cheaper
   * than per-channel `levels` filters because the loop never runs and no
   * channel receives the entry. Pass `undefined` to clear and accept all
   * levels again.
   *
   * @example
   * // production: silence debug noise everywhere at once
   * logger.setMinLevel("info");
   */
  public setMinLevel(level: LogLevel | undefined): this {
    this.minLevel = level;
    return this;
  }

  /**
   * Read the active minimum severity (or `undefined` when none is set).
   */
  public getMinLevel(): LogLevel | undefined {
    return this.minLevel;
  }

  /**
   * Set channels
   */
  public setChannels(channels: LogChannel[]) {
    this.channels = channels;

    return this;
  }

  /**
   * Normalize log data to a single object
   */
  private normalizeLogData(
    dataOrModule: LoggingData | OmittedLoggingData | string,
    action?: string,
    message: any = "",
    level?: LogLevel,
    context?: Record<string, any>,
  ): LoggingData {
    if (typeof dataOrModule === "object") {
      // If level is provided, override type
      return {
        type: (level || (dataOrModule as any).type || "info") as LogLevel,
        module: dataOrModule.module,
        action: dataOrModule.action,
        message: dataOrModule.message,
        ...(context ? { context } : dataOrModule.context ? { context: dataOrModule.context } : {}),
      };
    }
    return {
      type: (level || "info") as LogLevel,
      module: dataOrModule,
      action: action as string,
      message,
      ...(context ? { context } : {}),
    };
  }

  /**
   * Make log
   *
   * Fans out a single log entry to every registered channel. Non-terminal
   * channels receive a copy whose `message` has had ANSI color codes stripped
   * — each channel sees its own shallow clone so one channel cannot observe
   * another's mutations (e.g. a later terminal channel still sees the original
   * colored message).
   */
  public async log(data: LoggingData) {
    if (this.minLevel && LEVEL_RANK[data.type] < LEVEL_RANK[this.minLevel]) {
      return this;
    }

    // Apply the logger-wide redact floor once. Every channel sees the
    // result; no channel can undo a logger-wide redaction (additive-only
    // semantics).
    const baseEntry = applyRedact(data, this.redactConfig);

    for (const channel of this.channels) {
      const channelRedact = channel.getRedactConfig?.();
      const effectiveRedact = channelRedact
        ? mergeRedact(this.redactConfig, channelRedact)
        : undefined;

      // When the channel adds paths, redact again from `data` rather than
      // from `baseEntry` so the merged config (which already contains the
      // logger-wide paths) does the full pass — avoids double-cloning the
      // already-redacted base.
      let payload = effectiveRedact ? applyRedact(data, effectiveRedact) : baseEntry;

      if (channel.terminal === false) {
        payload = { ...payload, message: clearMessage(payload.message) };
      }

      channel.log(payload);
    }

    return this;
  }

  /**
   * Make debug log
   */
  public debug(
    dataOrModule: OmittedLoggingData | string,
    action?: string,
    message: any = "",
    context?: Record<string, any>,
  ) {
    const data = this.normalizeLogData(dataOrModule, action, message, "debug", context);
    return this.log(data);
  }

  /**
   * Make info log
   */
  public info(
    dataOrModule: OmittedLoggingData | string,
    action?: string,
    message: any = "",
    context?: Record<string, any>,
  ) {
    const data = this.normalizeLogData(dataOrModule, action, message, "info", context);
    return this.log(data);
  }

  /**
   * Make warn log
   */
  public warn(
    dataOrModule: OmittedLoggingData | string,
    action?: string,
    message: any = "",
    context?: Record<string, any>,
  ) {
    const data = this.normalizeLogData(dataOrModule, action, message, "warn", context);
    return this.log(data);
  }

  /**
   * Make error log
   */
  public error(
    dataOrModule: OmittedLoggingData | string,
    action?: string,
    message: any = "",
    context?: Record<string, any>,
  ) {
    const data = this.normalizeLogData(dataOrModule, action, message, "error", context);
    return this.log(data);
  }

  /**
   * Make success log
   */
  public success(
    dataOrModule: OmittedLoggingData | string,
    action?: string,
    message: any = "",
    context?: Record<string, any>,
  ) {
    const data = this.normalizeLogData(dataOrModule, action, message, "success", context);

    return this.log(data);
  }

  /**
   * Make fatal log — for unrecoverable failures where the application is going
   * down (failed bootstrap, lost connection to a required dependency that the
   * caller has decided not to retry, an `uncaughtException`).
   *
   * Identical shape to {@link error}; the level is purely informational —
   * `fatal` does NOT auto-flush or exit. The caller decides whether to call
   * `await log.flush()` and `process.exit(...)`.
   */
  public fatal(
    dataOrModule: OmittedLoggingData | string,
    action?: string,
    message: any = "",
    context?: Record<string, any>,
  ) {
    const data = this.normalizeLogData(dataOrModule, action, message, "fatal", context);

    return this.log(data);
  }

  /**
   * Log an `error` entry when `condition` is falsy. No-op otherwise — the
   * entry is never built and channels are not invoked, so this is genuinely
   * free in the happy path. Mirrors the spirit of `console.assert` but routes
   * through the logger pipeline so persistent channels capture failures.
   *
   * @example
   * log.assert(user !== null, "auth", "session", "user vanished mid-flight", { sessionId });
   */
  public assert(
    condition: unknown,
    module: string,
    action: string,
    message: any,
    context?: Record<string, any>,
  ): Promise<Logger> | Logger {
    if (condition) return this;
    return this.error(module, action, message, context);
  }

  /**
   * Start a duration timer. The returned function emits an `info` entry
   * with `completed in <ms>ms` and a `durationMs` field in `context` when
   * called. Pass an object to `end()` to merge extra fields into context.
   *
   * @example
   * const end = log.timer("db", "users.findById");
   * const user = await usersRepo.findById(id);
   * end({ id, found: !!user });
   */
  public timer(
    module: string,
    action: string,
  ): (extra?: Record<string, any>) => Promise<Logger> {
    const startedAt = Date.now();
    return (extra?: Record<string, any>) => {
      const durationMs = Date.now() - startedAt;
      return this.info(module, action, `completed in ${durationMs}ms`, {
        durationMs,
        ...(extra ?? {}),
      });
    };
  }

  /**
   * Get channel by name
   */
  public channel(name: string) {
    return this.channels.find((channel) => channel.name === name);
  }

  /**
   * Synchronously flush logs
   */
  public flushSync() {
    for (const channel of this.channels) {
      if (channel.flushSync) {
        channel.flushSync();
      }
    }
  }

  /**
   * Asynchronously drain every channel that implements `flush()`.
   *
   * Unlike {@link flushSync}, this awaits each channel's async I/O — the
   * correct call for a graceful shutdown that can afford to wait
   * (`await log.flush()` after closing the HTTP server, before
   * `process.exit`). A channel whose delivery is async (a network transport,
   * an async disk write) implements `flush()`, not `flushSync()`.
   *
   * Channels are isolated: a channel whose flush rejects can neither prevent
   * the others from draining nor escape as an unhandled rejection. Channels
   * without `flush()` are skipped.
   *
   * @example
   * async function shutdown() {
   *   await httpServer.close();
   *   await log.flush();
   *   process.exit(0);
   * }
   */
  public async flush(): Promise<void> {
    await Promise.allSettled(
      this.channels.map(async (channel) => {
        if (!channel.flush) {
          return;
        }

        try {
          await channel.flush();
        } catch {
          // A single channel must never break shutdown for the others —
          // a graceful drain is best-effort across every channel.
        }
      }),
    );
  }

  /**
   * Register one process-level handler per event that calls `flushSync()`
   * before the process terminates.
   *
   * For signal events (`SIGINT`, `SIGTERM`, `SIGHUP`, `SIGBREAK`, `SIGUSR2`)
   * the handler flushes and then re-raises the signal so Node's default exit
   * behavior runs. For `beforeExit`, the handler flushes in place — Node exits
   * naturally afterwards.
   *
   * Idempotent: calling with the same events replaces the previous handlers.
   * Call `disableAutoFlush()` to unregister.
   *
   * @example
   * log.configure({
   *   channels: [new ConsoleLog(), new FileLog()],
   *   autoFlushOn: ["SIGINT", "SIGTERM", "beforeExit"],
   * });
   */
  public enableAutoFlush(events: AutoFlushEvent[]): this {
    this.disableAutoFlush();

    for (const event of events) {
      const handler = SIGNAL_EVENTS.has(event)
        ? () => {
            this.flushSync();
            process.off(event, handler);
            process.kill(process.pid, event as NodeJS.Signals);
          }
        : () => {
            this.flushSync();
          };

      process.on(event, handler);
      this.autoFlushHandlers.set(event, handler);
    }

    return this;
  }

  /**
   * Remove every handler previously registered by `enableAutoFlush`.
   * Safe to call when no handlers are registered.
   */
  public disableAutoFlush(): this {
    for (const [event, handler] of this.autoFlushHandlers) {
      process.off(event, handler);
    }

    this.autoFlushHandlers.clear();

    return this;
  }
}

/**
 * The package singleton. Use this for everyday logging — `log.info(...)`,
 * `log.error(...)`, `log.configure(...)`. Custom logger instances can be
 * created by instantiating `Logger` directly.
 *
 * The name is intentionally short: `log` reads naturally at the call site
 * (`log.info("auth", "login", "ok")`) and matches the convention used in
 * pino, bunyan, and most JS logging tutorials.
 *
 * Note that `log` is a `Logger` instance, **not** a function — the bare
 * callable form was removed when the dual `log` / `logger` exports were
 * collapsed into a single name. Use `log.info(...)` (or any other level
 * shortcut) to emit entries.
 */
export const log = new Logger();
