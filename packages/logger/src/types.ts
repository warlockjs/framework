export type LogLevel = "debug" | "info" | "warn" | "error" | "success";

export type DebugMode = "daily" | "monthly" | "yearly" | "hourly";

export interface LogContract {
  /**
   * Channel name
   */
  name: string;

  /**
   * Channel description
   */
  description?: string;

  /**
   * Determine if channel is logging in terminal
   */
  terminal?: boolean;

  /**
   * Log the given message
   */
  log(
    module: string,
    action: string,
    message: any,
    level: LogLevel
  ): void | Promise<void>;
}
