import { LogChannel } from "../log-channel";
import type { BasicLogConfigurations, LoggingData, LogLevel } from "../types";
import { safeJsonStringify } from "../utils/safe-json-stringify";

// ── Lazily-loaded @sentry/node SDK ──────────────────────────────────────────
// @sentry/node is an OPTIONAL peer: an app that never registers SentryLog never
// installs it. We dynamic-import it the first time a channel needs it and
// surface a curated install message instead of a raw module-resolution stack
// trace. Mirrors the optional-driver convention in @warlock.js/cascade.

type SentrySdk = typeof import("@sentry/node");

let Sentry: SentrySdk | undefined;
let isModuleExists: boolean | null = null;
let loadingPromise: Promise<void> | undefined;

const SENTRY_INSTALL_INSTRUCTIONS = `
The Sentry log channel requires the @sentry/node package.
Install it with:

  npm install @sentry/node

Or with your preferred package manager:

  pnpm add @sentry/node
  yarn add @sentry/node
`.trim();

/**
 * Load @sentry/node once, lazily and concurrency-safely. A bare catch maps any
 * import failure to "not installed" — the curated install message surfaces at
 * `log()` time, never as a boot-time module-resolution crash.
 */
function loadSentry(): Promise<void> {
  if (isModuleExists !== null) {
    return Promise.resolve();
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      Sentry = await import("@sentry/node");
      isModuleExists = true;
    } catch {
      isModuleExists = false;
    }
  })();

  return loadingPromise;
}

/**
 * Sentry severity levels — the `@sentry/node` `SeverityLevel` union, declared
 * locally so the level mapping stays readable and is not coupled to a runtime
 * SDK import.
 */
type SentrySeverityLevel =
  | "fatal"
  | "error"
  | "warning"
  | "log"
  | "info"
  | "debug";

/**
 * The subset of the `@sentry/node` surface `SentryLog` calls. The `@sentry/node`
 * namespace satisfies this shape, so an app can pass it straight through as
 * `client`; a test (or a custom forwarder) can supply a compatible stand-in.
 */
export type SentryForwarder = Pick<
  SentrySdk,
  "captureException" | "captureMessage" | "addBreadcrumb" | "withScope" | "flush"
>;

export type SentryLogConfig = BasicLogConfigurations & {
  /**
   * Reuse an already-initialized Sentry instance — typically the `@sentry/node`
   * namespace from an app that already calls `Sentry.init(...)`. When set, the
   * channel forwards through it and never imports or re-initializes the SDK.
   */
  client?: SentryForwarder;
  /**
   * Initialize Sentry from these options instead of reusing a host client. The
   * channel lazily imports `@sentry/node` and calls `Sentry.init(options)` once,
   * guarded so it never clobbers an existing client.
   */
  options?: import("@sentry/node").NodeOptions;
  /**
   * Levels delivered as Sentry *events* (these consume the error quota). Every
   * other level is recorded as a breadcrumb that rides along with the next
   * event, costing no quota.
   *
   * @default ["error", "warn"]
   */
  eventLevels?: LogLevel[];
  /**
   * Milliseconds `flush()` waits for the transport to drain on shutdown.
   *
   * @default 2000
   */
  flushTimeout?: number;
};

/**
 * Forwards log entries to Sentry.
 *
 * Entries at an `eventLevels` level (`error` / `warn` by default) become Sentry
 * **events**: an `Error` message via `captureException` (preserving the real
 * stack), any other message via `captureMessage`. Every other level becomes a
 * **breadcrumb** — buffered and attached to the next event, consuming no error
 * quota. `module` / `action` are attached as searchable tags and the entry's
 * `context` as a structured Sentry context.
 *
 * The SDK is an optional peer: pass an existing `client` (reused as-is) or
 * `options` (the channel lazily imports `@sentry/node` and initializes it). On
 * graceful shutdown, `await log.flush()` drains pending events via
 * `Sentry.flush(timeout)`.
 *
 * @example
 * // Existing app — reuse the initialized Sentry client
 * import * as Sentry from "@sentry/node";
 * log.addChannel(new SentryLog({ client: Sentry }));
 *
 * @example
 * // New app — let the channel initialize Sentry
 * log.addChannel(new SentryLog({ options: { dsn: process.env.SENTRY_DSN } }));
 */
export class SentryLog extends LogChannel<SentryLogConfig> {
  /**
   * {@inheritdoc}
   */
  public name = "sentry";

  /**
   * {@inheritdoc}
   */
  public description =
    "Forwards entries to Sentry as events (error/warn) or breadcrumbs (everything else)";

  /**
   * {@inheritdoc}
   */
  protected defaultConfigurations: SentryLogConfig = {
    eventLevels: ["error", "warn"],
    flushTimeout: 2000,
  };

  /**
   * The resolved forwarder — the injected `client` or the lazily-imported
   * `@sentry/node` namespace. `undefined` until `init()` resolves, and when the
   * SDK is absent (then `log()` surfaces the install message once).
   */
  private sentry?: SentryForwarder;

  /**
   * Guards the one-time "@sentry/node is not installed" notice so a missing SDK
   * doesn't spam stderr on every entry.
   */
  private warnedMissing = false;

  /**
   * Resolve the forwarder: reuse the injected client, otherwise lazily import
   * `@sentry/node` and (only when explicit `options` are supplied and no client
   * exists yet) initialize it. Never throws — the base runs `init()` inside an
   * un-awaited `setTimeout`, so a throw would become an unhandled rejection and
   * `isInitialized` would never flip; a missing SDK is reported from `log()`.
   */
  protected async init(): Promise<void> {
    const injected = this.config("client");

    if (injected) {
      this.sentry = injected;

      return;
    }

    await loadSentry();

    if (!Sentry) {
      return;
    }

    const options = this.config("options");

    if (options && !Sentry.getClient()) {
      Sentry.init(options);
    }

    this.sentry = Sentry;
  }

  /**
   * {@inheritdoc}
   */
  public async log(data: LoggingData): Promise<void> {
    if (!this.shouldBeLogged(data)) {
      return;
    }

    if (!this.sentry) {
      this.reportMissingSdk();

      return;
    }

    const { module, action, message, type: level, context } = data;

    if (this.isEventLevel(level)) {
      this.captureEvent(this.sentry, { module, action, message, level, context });

      return;
    }

    this.sentry.addBreadcrumb({
      category: module,
      message: this.toText(message),
      level: this.toSentryLevel(level),
      data: context,
    });
  }

  /**
   * Drain pending Sentry events. Bounded by `flushTimeout` so an unreachable
   * Sentry can never hang a graceful shutdown. No-op when the SDK is absent.
   */
  public async flush(): Promise<void> {
    if (!this.sentry) {
      return;
    }

    await this.sentry.flush(this.config("flushTimeout"));
  }

  /**
   * Whether the level should be sent as a Sentry event (vs a breadcrumb).
   */
  private isEventLevel(level: LogLevel): boolean {
    return Boolean(this.config("eventLevels")?.includes(level));
  }

  /**
   * Send an entry as a Sentry event. An `Error` message goes through
   * `captureException` so Sentry parses the real stack and groups properly;
   * any other message goes through `captureMessage`. `module` / `action` are
   * attached as tags and `context` as a structured context, scoped to this
   * event only via `withScope`.
   */
  private captureEvent(
    sentry: SentryForwarder,
    entry: {
      module: string;
      action: string;
      message: unknown;
      level: LogLevel;
      context?: Record<string, any>;
    },
  ): void {
    const { module, action, message, level, context } = entry;
    const sentryLevel = this.toSentryLevel(level);

    sentry.withScope((scope) => {
      scope.setLevel(sentryLevel);
      scope.setTags({ module, action });

      if (context) {
        scope.setContext("context", context);
      }

      if (message instanceof Error) {
        sentry.captureException(message);
      } else {
        sentry.captureMessage(this.toText(message), sentryLevel);
      }
    });
  }

  /**
   * Map a logger level to a Sentry severity. `success` has no Sentry
   * equivalent, so it is reported as informational.
   */
  private toSentryLevel(level: LogLevel): SentrySeverityLevel {
    switch (level) {
      case "warn":
        return "warning";
      case "success":
        return "info";
      default:
        return level; // debug | info | error map 1:1
    }
  }

  /**
   * Coerce a message into the string Sentry's APIs expect — an `Error`'s
   * `.message`, a string as-is, anything else safely JSON-serialized.
   */
  private toText(message: unknown): string {
    if (typeof message === "string") {
      return message;
    }

    if (message instanceof Error) {
      return message.message;
    }

    return safeJsonStringify(message);
  }

  /**
   * Surface the install instructions exactly once when the SDK is absent. The
   * logger can't log through itself here, so this writes to stderr — matching
   * how the file channels report write failures.
   */
  private reportMissingSdk(): void {
    if (isModuleExists === false && !this.warnedMissing) {
      this.warnedMissing = true;
      console.error(SENTRY_INSTALL_INSTRUCTIONS);
    }
  }
}
