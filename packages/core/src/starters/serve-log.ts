import { ConsoleLog } from "@warlock.js/logger";

const consoleLog = new ConsoleLog();

export const httpLog = {
  info: (module: string, action: string, message: string) => {
    consoleLog.log({
      module,
      action,
      message,
      type: "info",
    });
  },
  error: (module: string, action: string, message: string) => {
    consoleLog.log({
      module,
      action,
      message,
      type: "error",
    });
  },
  warn: (module: string, action: string, message: string) => {
    consoleLog.log({
      module,
      action,
      message,
      type: "warn",
    });
  },
  debug: (module: string, action: string, message: string) => {
    consoleLog.log({
      module,
      action,
      message,
      type: "debug",
    });
  },
  success: (module: string, action: string, message: string) => {
    consoleLog.log({
      module,
      action,
      message,
      type: "success",
    });
  },
};
