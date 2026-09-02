import { log } from "@warlock.js/logger";

/**
 * Guarantee a fatal boot error reaches the terminal.
 *
 * `log.fatal(...)` fans out over `Logger.channels` and does NOTHING when that
 * list is empty or holds only non-terminal channels — which is the normal
 * shape of a production `src/config/log.ts` (`production: { channels: [new
 * FileLog()] }`), and the shape of every app that ships no `log` config at all,
 * because `LoggerConnector.start()` returns early and never calls
 * `log.configure`. A boot failure reported only through `log.fatal` in that
 * window is a boot failure nobody ever sees: the process exits non-zero having
 * written nothing to stdout or stderr, and a supervising `warlock start` can
 * only report that no output was captured.
 *
 * This is the same guarantee `captureAnyUnhandledRejection` already makes for
 * an `uncaughtException` (see `@warlock.js/logger`), applied to the failures a
 * connector catches itself and therefore never lets reach that handler.
 *
 * Skipped when a terminal channel exists, so a configured `ConsoleLog` is
 * never doubled.
 */
export function ensureFatalIsVisible(error: unknown): void {
  const hasTerminalChannel = log.channels.some((channel) => channel.terminal !== false);

  if (hasTerminalChannel) {
    return;
  }

  console.error(error);
}
