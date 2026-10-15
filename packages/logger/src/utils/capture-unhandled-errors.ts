import { log } from "../logger";

/**
 * Options for {@link captureAnyUnhandledRejection}.
 */
export type CaptureUnhandledOptions = {
  /**
   * Take the process down with `process.exit(1)` after an `uncaughtException`
   * is logged. Defaults to `true` — an uncaught exception leaves the process
   * in an undefined state, so Node's own default is to exit non-zero.
   *
   * Registering an `uncaughtException` listener *suppresses* that default, so a
   * listener that only logs turns an unrecoverable crash into a silent
   * `exit 0` (which is how a config file throwing at boot looks like "the
   * server just stopped"). Keep this `true` in production so supervisors
   * restart and the failure is never silent. Set it to `false` where the
   * process is expected to recover on its own — e.g. a dev server that reloads
   * via HMR — to log the exception without exiting.
   */
  exitOnUncaughtException?: boolean;
};

/**
 * Best-effort budget (ms) for draining async channels (file, Sentry, …) before
 * the forced exit. Bounded so a single stuck channel can't hang the process —
 * `process.exit()` skips `beforeExit`, so an `autoFlushOn: ["beforeExit"]`
 * handler would not cover this path.
 */
const FLUSH_BUDGET_BEFORE_EXIT = 1000;

/**
 * Route Node's process-level failure events through the logger so they land in
 * every configured channel with full stack context, and make an
 * `uncaughtException` loud + visible instead of silently swallowed.
 *
 * Registers one listener for `unhandledRejection` and one for
 * `uncaughtException`; call once at startup after channels are configured.
 *
 * - `uncaughtException` → `log.fatal`, then (by default) `process.exit(1)`.
 *   When no terminal channel has been configured yet — the early-boot window a
 *   config file throwing at import time falls into — the stack is also written
 *   to `console.error`, standing in for the Node default this listener
 *   suppresses, so a fatal boot error is never invisible. A configured
 *   `ConsoleLog` already prints it, so the fallback is skipped when a terminal
 *   channel exists (no double output).
 * - `unhandledRejection` → `log.error` — a rejected promise is a failure but
 *   not necessarily process-ending, so it stays at error and never exits.
 *
 * @example
 * log.configure({ channels: [new ConsoleLog(), new FileLog()] });
 * captureAnyUnhandledRejection();                                   // exits on uncaught
 * captureAnyUnhandledRejection({ exitOnUncaughtException: false }); // dev: log only
 */
export function captureAnyUnhandledRejection(options: CaptureUnhandledOptions = {}) {
  const { exitOnUncaughtException = true } = options;

  process.on("unhandledRejection", (reason: any) => {
    log.error("app", "unhandledRejection", reason);
  });

  process.on("uncaughtException", (error) => {
    // Route through the logger first so file/Sentry channels capture it. A
    // crash handler must never itself throw (that would re-enter Node's
    // uncaught path), so the logging call is guarded.
    try {
      log.fatal("app", "uncaughtException", error);
    } catch {
      // fall through to the stderr fallback + exit below
    }

    // Guarantee terminal visibility. `log.fatal` reaches nothing the user can
    // see when this fires before any terminal channel is configured — exactly
    // the early-boot window a config file throwing at import time falls into,
    // which is how a fatal boot error used to masquerade as a silent
    // `exit 0`. Stand in for the Node default this listener suppressed, but
    // only when no terminal channel already printed it, so a configured
    // `ConsoleLog` is never doubled.
    const hasTerminalChannel = log.channels.some((channel) => channel.terminal !== false);

    if (!hasTerminalChannel) {
      console.error(error);
    }

    if (!exitOnUncaughtException) {
      return;
    }

    // Best-effort, time-bounded flush of async channels, then exit non-zero so
    // process supervisors restart and `warlock start` surfaces the failure.
    void Promise.race([
      log.flush(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, FLUSH_BUDGET_BEFORE_EXIT);
        timer.unref?.();
      }),
    ]).then(
      () => process.exit(1),
      () => process.exit(1),
    );
  });
}
