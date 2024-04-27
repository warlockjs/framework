import { log } from "./logger";

export function captureAnyUnhandledRejection() {
  process.on("unhandledRejection", (reason: string, promise) => {
    log.error("app", reason, promise);
    console.log(promise);
    // console.trace();
  });

  process.on("uncaughtException", (error) => {
    log.error("app", "error", error);
    // console.trace();
    console.log(error);
  });
}

/**
 * Clear message from any terminal codes
 */
export function clearMessage(message: any) {
  if (typeof message !== "string") return message;

  // eslint-disable-next-line no-control-regex
  return message.replace(/\u001b[^m]*?m/g, "");
}
