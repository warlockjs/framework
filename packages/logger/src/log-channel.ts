import { maskRegisteredLogSecrets } from "./redact/registered-secrets";
import type { BasicLogConfigurations, LogContract, LoggingData, RedactConfig } from "./types";

/**
 * Receives a failure the channel hits outside a `log()` call (for example
 * `FileLog` retention). The logger installs one that forwards to its
 * `onChannelError` handler.
 */
export type ChannelErrorReporter = (error: unknown, entry: LoggingData) => void;

export abstract class LogChannel<
  Options extends BasicLogConfigurations = BasicLogConfigurations,
> implements LogContract {
  /**
   * Channel name
   */
  public name!: string;

  /**
   * Channel description
   */
  public description?: string;

  /**
   * Determine if channel is logging in terminal
   */
  public terminal = false;

  /**
   * A passive channel only observes entries (it keeps them in memory or
   * derives data from them) and persists nothing. Passive channels do not
   * count as a place a log entry can end up: code that falls back to the
   * terminal "when no log channel is configured" ignores them.
   */
  public passive = false;

  /**
   * Default Configurations
   */
  protected defaultConfigurations: Options = {} as Options;

  /**
   * Channel configurations
   */
  protected channelConfigurations: Options = {} as Options; //

  /**
   * Determine whether the channel is fully initialized
   */
  protected isInitialized = false;

  /**
   * Where {@link reportError} sends failures; set by the logger the channel
   * is added to.
   */
  protected errorReporter?: ChannelErrorReporter;

  /**
   * Constructor
   */
  public constructor(configurations?: Options) {
    if (configurations) {
      this.setConfigurations(configurations);
    }

    setTimeout(async () => {
      if (this.init) {
        await this.init();
      }

      this.isInitialized = true;
    }, 0);
  }

  /**
   * Route this channel's own failures (those outside a `log()` call) to the
   * given reporter. `Logger` calls this when the channel is added, so the
   * failures reach `log.onChannelError(...)`.
   */
  public setErrorReporter(reporter: ChannelErrorReporter | undefined): void {
    this.errorReporter = reporter;
  }

  /**
   * Report a failure that happened outside a `log()` call. Never throws:
   * without a reporter it writes one line to stderr.
   */
  protected reportError(error: unknown, entry: LoggingData): void {
    try {
      if (this.errorReporter) {
        this.errorReporter(error, entry);
        return;
      }

      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        maskRegisteredLogSecrets(`[@warlock.js/logger] channel "${this.name}" failed: ${reason}\n`),
      );
    } catch {
      // Reporting a failure must never become one.
    }
  }

  /**
   * Initialize the channel
   */
  protected init?(): void | Promise<void>;

  /**
   * Get config value
   */
  protected config<K extends keyof Options>(key: K): Options[K] {
    return this.channelConfigurations[key] ?? (this.defaultConfigurations ?? {})[key];
  }

  /**
   * Set configurations
   */
  protected setConfigurations(configurations: Options) {
    this.channelConfigurations = {
      ...this.channelConfigurations,
      ...configurations,
    };

    return this;
  }

  /**
   * Determine if the message should be logged
   */
  protected shouldBeLogged(data: LoggingData): boolean {
    // check for debug mode
    const allowedLevels = this.config("levels");

    if (allowedLevels?.length && !allowedLevels.includes(data.type)) return false;

    const filter = this.config("filter");

    if (filter) {
      return filter(data);
    }

    return true;
  }

  /**
   * Log the given message
   */
  public abstract log(data: LoggingData): void | Promise<void>;

  /**
   * Synchronously flush messages
   */
  public flushSync?(): void;

  /**
   * Asynchronously flush buffered messages.
   *
   * Optional — channels that write synchronously per entry (e.g. `ConsoleLog`)
   * don't implement it. Buffering channels override this to drain their buffer
   * over async I/O so callers can `await log.flush()` on graceful shutdown.
   */
  public flush?(): void | Promise<void>;

  /**
   * Read the channel's redact config (if any). Used by `Logger` to apply
   * per-channel additive redaction on top of the logger-wide floor.
   * Subclasses normally don't override this — set `redact` in your channel
   * configuration instead.
   */
  public getRedactConfig(): RedactConfig | undefined {
    return this.config("redact" as keyof Options) as RedactConfig | undefined;
  }

  /**
   * Get date and time formats
   */
  protected getDateAndTimeFormat() {
    const dateFormat = this.config("dateFormat");
    const date = dateFormat?.date ?? "DD-MM-YYYY";
    const time = dateFormat?.time ?? "HH:mm:ss";

    return { date, time };
  }

  /**
   * get basic configurations with the given ones
   */
  protected withBasicConfigurations(configurations: Partial<Options>): Options {
    return {
      filter: () => true,
      ...configurations,
    } as any as Options;
  }
}
