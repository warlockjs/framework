import { log } from "../logger";

/**
 * Route Node's process-level failure events through the logger so they land in
 * every configured channel with full stack context. Registers one listener for
 * `unhandledRejection` and one for `uncaughtException`; call once at startup
 * after channels are configured. Pair with `autoFlushOn: ["beforeExit"]` so the
 * final entry survives the process exit that follows an uncaught exception.
 *
 * Levels chosen for semantic honesty:
 *
 * - `uncaughtException` → `log.fatal` — by default Node terminates the process,
 *   so the failure is unrecoverable.
 * - `unhandledRejection` → `log.error` — a rejected promise is a failure, but
 *   not necessarily process-ending (depends on Node's `--unhandled-rejections`
 *   policy and your app's recovery), so it stays at error.
 *
 * @example
 * log.configure({ channels: [new ConsoleLog(), new FileLog()] });
 * captureAnyUnhandledRejection();
 */
export function captureAnyUnhandledRejection() {
  process.on("unhandledRejection", (reason: any) => {
    log.error("app", "unhandledRejection", reason);
  });

  process.on("uncaughtException", (error) => {
    log.fatal("app", "uncaughtException", error);
  });
}
