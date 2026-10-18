import { Random } from "@mongez/reinforcements";
import type { LogChannel } from "./log-channel";
import { applyRedact, mergeRedact, maskRegisteredLogSecrets } from "./redact";
import { redactRegisteredSecrets } from "./redact/registered-secrets";
import type {
  AutoFlushEvent,
  ChannelErrorHandler,
  LogContract,
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
   * Deliveries still in flight on async channels, per channel. `log()` never
   * awaits them; `flush()` does, so a graceful shutdown still waits for every
   * entry. Kept per channel so one hung channel cannot hold up another's
   * drain.
   */
  private pendingDeliveries = new Map<LogChannel, Set<Promise<void>>>();

  /**
   * Receives a channel's delivery failure (a sync throw or a rejected async
   * `log()`). Defaults to a single stderr line, never back through the logger.
   */
  private channelErrorHandler: ChannelErrorHandler = reportChannelError;

  /**
   * Add a new channel
   */
  public addChannel(channel: LogChannel) {
    this.channels.push(this.attachChannel(channel));

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
    onChannelError?: ChannelErrorHandler;
  }) {
    if (config.channels) {
      this.setChannels(config.channels);
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

    if (config.onChannelError) {
      this.onChannelError(config.onChannelError);
    }

    return this;
  }

  /**
   * Handle a channel's delivery failure. Logging is fire-and-forget, so a
   * channel that throws or rejects never reaches the call site and never
   * becomes an unhandled rejection; it goes to this handler instead. The
   * default writes one line to stderr. The handler must not log through this
   * logger (a failing channel would loop).
   *
   * @example
   * log.onChannelError((error, channel) => metrics.increment(`log.${channel.name}.failed`));
   */
  public onChannelError(handler: ChannelErrorHandler): this {
    this.channelErrorHandler = handler;
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

    for (const channel of channels) {
      this.attachChannel(channel);
    }

    return this;
  }

  /**
   * Route a channel's own failures (outside `log()`, such as file retention)
   * to this logger's channel error handler.
   */
  private attachChannel(channel: LogChannel): LogChannel {
    if (typeof channel.setErrorReporter === "function") {
      channel.setErrorReporter((error, entry) => this.reportChannelError(error, channel, entry));
    }

    return channel;
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
   *
   * Synchronous and fire-and-forget: it returns the logger, not a promise.
   * Async channel deliveries are tracked and awaited by {@link flush}; a
   * channel that throws or rejects is isolated from the others and reported
   * to {@link onChannelError}.
   */
  public log(data: LoggingData): this {
    if (this.minLevel && LEVEL_RANK[data.type] < LEVEL_RANK[this.minLevel]) {
      return this;
    }

    // Apply the logger-wide redact floor once. Every channel sees the
    // result; no channel can undo a logger-wide redaction (additive-only
    // semantics). A redaction that throws (a bad censor function) drops the
    // entry: delivering it unredacted would leak exactly what the config
    // exists to hide.
    let baseEntry: LoggingData;

    try {
      baseEntry = applyRedact(data, this.redactConfig);
    } catch (error) {
      for (const channel of this.channels) {
        this.reportChannelError(error, channel, redactionFailedEntry(data));
      }

      return this;
    }

    for (const channel of this.channels) {
      this.deliver(channel, data, baseEntry);
    }

    return this;
  }

  /**
   * Prepare and hand one entry to one channel, isolating its failure (a
   * channel redaction that throws included) and tracking an async delivery
   * until it settles.
   */
  private deliver(channel: LogChannel, data: LoggingData, baseEntry: LoggingData) {
    let payload: LoggingData = baseEntry;
    let result: void | Promise<void>;

    try {
      const channelRedact = channel.getRedactConfig?.();

      // When the channel adds paths, redact again from `data` rather than
      // from `baseEntry` so the merged config (which already contains the
      // logger-wide paths) does the full pass — avoids double-cloning the
      // already-redacted base.
      if (channelRedact) {
        payload = applyRedact(data, mergeRedact(this.redactConfig, channelRedact));
      }

      if (channel.terminal === false) {
        payload = { ...payload, message: clearMessage(payload.message) };
      }

      result = channel.log(payload);
    } catch (error) {
      // `payload` is the logger-wide redacted entry until the channel's own
      // redaction succeeded, so the handler never sees less-redacted data
      // than some channel would have.
      this.reportChannelError(error, channel, payload);
      return;
    }

    if (!result || typeof (result as Promise<void>).then !== "function") {
      return;
    }

    let pending = this.pendingDeliveries.get(channel);

    if (!pending) {
      pending = new Set();
      this.pendingDeliveries.set(channel, pending);
    }

    const tracked = pending;
    const delivery: Promise<void> = Promise.resolve(result)
      .catch((error) => this.reportChannelError(error, channel, payload))
      .finally(() => {
        tracked.delete(delivery);

        if (tracked.size === 0 && this.pendingDeliveries.get(channel) === tracked) {
          this.pendingDeliveries.delete(channel);
        }
      });

    tracked.add(delivery);
  }

  private reportChannelError(error: unknown, channel: LogContract, entry: LoggingData) {
    try {
      const outcome: unknown = this.channelErrorHandler(
        redactRegisteredSecrets(error),
        channel,
        redactRegisteredSecrets(entry),
      );

      // An async handler that rejects must not become an unhandled rejection
      // (which an app may route straight back into this logger).
      if (outcome && typeof (outcome as Promise<unknown>).then === "function") {
        (outcome as Promise<unknown>).then(undefined, () => {});
      }
    } catch {
      // An error handler that throws must not turn logging into a crash.
    }
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
  ): this {
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
  public timer(module: string, action: string): (extra?: Record<string, any>) => this {
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
   * Wait for every in-flight async delivery, then drain every channel that
   * implements `flush()` — bounded by `timeout` (default
   * {@link DEFAULT_FLUSH_TIMEOUT_MS}).
   *
   * Unlike {@link flushSync}, this awaits each channel's async I/O — the
   * correct call for a graceful shutdown that can afford to wait
   * (`await log.flush()` after closing the HTTP server, before
   * `process.exit`). A channel whose delivery is async (a network transport,
   * an async disk write) implements `flush()`, not `flushSync()`.
   *
   * Channels drain concurrently and independently: each waits for its own
   * pending deliveries (including ones logged while the flush runs), then
   * runs its `flush()`. A channel whose delivery hangs therefore cannot hold
   * up another channel's drain, and a channel whose flush rejects can neither
   * stop the others nor escape as an unhandled rejection. When `timeout`
   * elapses, `flush()` resolves anyway and each channel still draining is
   * reported to {@link onChannelError}. Channels without `flush()` only wait
   * for their deliveries.
   *
   * @example
   * async function shutdown() {
   *   await httpServer.close();
   *   await log.flush({ timeout: 3000 });
   *   process.exit(0);
   * }
   */
  public async flush(options: { timeout?: number } = {}): Promise<void> {
    const timeout = options.timeout ?? DEFAULT_FLUSH_TIMEOUT_MS;
    const draining = new Set<LogChannel>(this.channels);

    for (const channel of this.pendingDeliveries.keys()) {
      draining.add(channel);
    }

    const unfinished = new Set(draining);

    const drains = [...draining].map(async (channel) => {
      try {
        await this.drainChannel(channel);
      } catch {
        // A single channel must never break shutdown for the others —
        // a graceful drain is best-effort across every channel.
      } finally {
        unfinished.delete(channel);
      }
    });

    const settled = Promise.allSettled(drains).then(() => false);

    // `Infinity` (or any non-finite value) waits without a limit; setTimeout
    // would otherwise overflow it to an immediate timeout.
    if (!Number.isFinite(timeout)) {
      await settled;
      return;
    }

    let resolveTimeout!: (timedOut: boolean) => void;
    const timeoutReached = new Promise<boolean>((resolve) => {
      resolveTimeout = resolve;
    });
    const timer = setTimeout(() => resolveTimeout(true), Math.max(0, timeout));

    // Never keep the process alive just to time a flush out.
    (timer as { unref?: () => void }).unref?.();

    const timedOut = await Promise.race([settled, timeoutReached]);

    clearTimeout(timer);

    if (!timedOut) return;

    for (const channel of unfinished) {
      this.reportChannelError(
        new Error(`flush timed out after ${timeout}ms; entries still in flight may be lost`),
        channel,
        { type: "warn", module: "logger", action: "flush", message: "flush timed out" },
      );
    }
  }

  /**
   * Wait until the channel has no delivery in flight, run its `flush()`, and
   * repeat while that flush let new deliveries in.
   */
  private async drainChannel(channel: LogChannel) {
    do {
      let pending = this.pendingDeliveries.get(channel);

      while (pending && pending.size > 0) {
        await Promise.allSettled([...pending]);
        pending = this.pendingDeliveries.get(channel);
      }

      if (channel.flush) {
        await channel.flush();
      }
    } while ((this.pendingDeliveries.get(channel)?.size ?? 0) > 0);
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
 * Default `timeout` of {@link Logger.flush}: long enough for a healthy network
 * channel, short enough that a hung one cannot eat a shutdown budget.
 */
export const DEFAULT_FLUSH_TIMEOUT_MS = 5000;

/**
 * What the error handler receives when the logger-wide redaction itself
 * failed: the entry's identity only, never the unredacted message or context.
 */
function redactionFailedEntry(data: LoggingData): LoggingData {
  return {
    type: data.type,
    module: data.module,
    action: data.action,
    message: "[entry dropped: redaction failed]",
  };
}

/**
 * Default {@link ChannelErrorHandler}: one stderr line per failure. Written
 * directly to the stream, never through a logger, so a broken channel cannot
 * recurse.
 */
function reportChannelError(error: unknown, channel: LogContract) {
  const reason = error instanceof Error ? error.message : String(error);

  try {
    process.stderr.write(
      maskRegisteredLogSecrets(
        `[@warlock.js/logger] channel "${channel.name}" failed to log: ${reason}\n`,
      ),
    );
  } catch {
    // stderr itself is gone; nothing left to report to.
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
