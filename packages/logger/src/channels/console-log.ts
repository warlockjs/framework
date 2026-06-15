import { colors } from "@mongez/copper";
import { inspect } from "util";
import { LogChannel } from "../log-channel";
import type { BasicLogConfigurations, LoggingData } from "../types";

export type ConsoleLogConfig = BasicLogConfigurations & {
  /**
   * Render the log entry's `context` object on a second line after the main
   * message. When `false`, context is silently dropped (the historical
   * behavior). When `true`, contexts are pretty-printed with `util.inspect`
   * — colored, depth-limited, ideal for development. Persistent channels
   * (`FileLog`, `JSONFileLog`) always retain context regardless of this flag.
   *
   * @default false
   */
  showContext?: boolean;
  /**
   * Depth passed to `util.inspect` when rendering context. Only applies when
   * `showContext` is enabled.
   *
   * @default 4
   */
  contextDepth?: number;
};

export class ConsoleLog extends LogChannel<ConsoleLogConfig> {
  /**
   * {@inheritdoc}
   */
  public name = "console";

  /**
   * Determine if channel is logging in terminal
   */
  public terminal = true;

  /**
   * {@inheritdoc}
   */
  public log(data: LoggingData) {
    const { module, action, message, type: level } = data;

    if (!this.shouldBeLogged(data)) return;

    // display date and time with milliseconds
    const date = new Date().toISOString(); // i.e 2021-01-01T00:00:00.000Z
    switch (level) {
      case "debug":
        // add a debug icon
        console.log(
          colors.magentaBright("⚙"),
          colors.yellow(`(${date})`),
          colors.cyan(`[${module}]`),
          colors.magenta(`[${action}]`),
          colors.magentaBright(message),
        );
        break;
      case "info":
        // add an info icon
        console.log(
          colors.blueBright("ℹ"),
          colors.yellow(`(${date})`),
          colors.cyan(`[${module}]`),
          colors.magenta(`[${action}]`),
          colors.blueBright(message),
        );
        break;
      case "warn":
        // add a warning icon
        console.log(
          colors.yellow("⚠"),
          colors.yellow(`(${date})`),
          colors.cyan(`[${module}]`),
          colors.magenta(`[${action}]`),
          colors.yellowBright(message),
        );
        break;
      case "error":
        // add an error icon
        console.log(
          colors.red("✗"),
          colors.yellow(`(${date})`),
          colors.cyan(`[${module}]`),
          colors.magenta(`[${action}]`),
          colors.redBright(message),
        );
        break;

      case "success":
        // add a success icon
        console.log(
          colors.green("✓"),
          colors.yellow(`(${date})`),
          colors.cyan(`[${module}]`),
          colors.magenta(`[${action}]`),
          colors.greenBright(message),
        );
        break;

      case "fatal":
        // background-red ☠ — visually distinct from `error` so a fatal entry
        // can't be missed in a wall of red logs
        console.log(
          colors.bgRedBright(colors.bold(" ☠ ")),
          colors.yellow(`(${date})`),
          colors.cyan(`[${module}]`),
          colors.magenta(`[${action}]`),
          colors.redBright.bold(message),
        );
        break;

      default:
        console.log(
          "[log]",
          colors.yellow(`(${date})`),
          colors.cyan(`[${module}]`),
          colors.magenta(`[${action}]`),
          message,
        );
    }

    if (typeof message === "object") {
      console.log(message);
    }

    // Render context on a second line when explicitly enabled. We only
    // attempt rendering if there's anything meaningful to show — empty
    // objects clutter the terminal without adding signal.
    if (this.config("showContext") && data.context && Object.keys(data.context).length > 0) {
      const depth = this.config("contextDepth") ?? 4;
      console.log(
        colors.gray("  ↳"),
        inspect(data.context, { colors: true, depth, breakLength: 80 }),
      );
    }
  }
}
