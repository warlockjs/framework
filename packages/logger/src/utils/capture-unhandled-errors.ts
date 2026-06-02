import { log } from "../logger";

/**
 * Route Node's process-level failure events through the logger so they land in
 * every configured channel with full stack context. Registers one listener for
 * `unhandledRejection` and one for `uncaughtException`; call once at startup
 * after channels are configured. Pair with `autoFlushOn: ["beforeExit"]` so the
 * final entry survives the process exit that follows an uncaught exception.
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
    log.error("app", "uncaughtException", error);
  });
}
