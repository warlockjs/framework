import { colors } from "@mongez/copper";
import { inspect } from "util";
import { LogChannel } from "../log-channel";
import type { BasicLogConfigurations, LoggingData, LogLevel } from "../types";

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

/**
 * The longest level name (`success`) sets the tag column width. Padding every
 * level name to this width keeps the timestamp / module / action columns
 * aligned across lines. The level icons are bare (text-style, single-cell)
 * glyphs, so padding the name alone produces true columns.
 */
const LEVEL_NAME_WIDTH = 7;

/**
 * Per-level console presentation: the colored, fixed-width `{icon} {name}` tag
 * and the function that colors the message body.
 */
type LevelStyle = {
  tag: string;
  message: (message: LoggingData["message"]) => string;
};

/**
 * Build a single-color, fixed-width tag — `{icon} {name}` with the name padded
 * so every tag spans the same number of columns.
 */
function buildTag(
  icon: string,
  name: string,
  color: (text: string) => string,
): string {
  return color(`${icon} ${name.padEnd(LEVEL_NAME_WIDTH)}`);
}

/**
 * Console styling per log level. The `fatal` tag is a bright-red background
 * badge — the same column width as the others (`" ☠ fatal "` is 9 cells, like
 * `{icon} {name.padEnd(7)}`), but impossible to miss in a wall of red `error`
 * lines, where a plain red tag would blend in.
 */
const LEVEL_STYLES: Record<LogLevel, LevelStyle> = {
  debug: {
    tag: buildTag("⚙", "debug", colors.magentaBright),
    message: colors.magentaBright,
  },
  info: {
    tag: buildTag("ℹ", "info", colors.blueBright),
    message: colors.blueBright,
  },
  warn: {
    tag: buildTag("⚠", "warn", colors.yellow),
    message: colors.yellowBright,
  },
  error: {
    tag: buildTag("✗", "error", colors.red),
    message: colors.redBright,
  },
  success: {
    tag: buildTag("✓", "success", colors.green),
    message: colors.greenBright,
  },
  fatal: {
    tag: colors.bgRedBright(colors.whiteBright(colors.bold(" ☠ fatal "))),
    message: colors.redBright.bold,
  },
};

/**
 * Fallback for an unrecognized level — a plain `[log]` tag padded to the same
 * width so the columns stay aligned.
 */
const DEFAULT_STYLE: LevelStyle = {
  tag: "[log]".padEnd(LEVEL_NAME_WIDTH + 2),
  message: message => message as string,
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

    // Console shows time-only (HH:mm:ss.SSS) — within a dev session the date
    // rarely changes, so the full ISO date + `T`/`Z` are just noise. Persistent
    // channels (FileLog / JSONFileLog) keep the full ISO timestamp.
    const time = new Date().toISOString().slice(11, 23); // i.e. "10:22:00.000"

    const style = LEVEL_STYLES[level] ?? DEFAULT_STYLE;

    // The slate timestamp recedes so the colored level + message lead the eye;
    // module (cyan) and action (magenta) stay colored for subsystem scanning.
    // `slate` (256-color neutral gray) reads cleaner than bright-black `gray`,
    // which sits too close to the background on most terminal themes.
    console.log(
      style.tag,
      colors.slate(`(${time})`),
      colors.cyan(`[${module}]`),
      colors.magenta(`[${action}]`),
      style.message(message),
    );

    if (typeof message === "object") {
      console.log(message);
    }

    // Render context on a second line when explicitly enabled. We only
    // attempt rendering if there's anything meaningful to show — empty
    // objects clutter the terminal without adding signal.
    if (this.config("showContext") && data.context && Object.keys(data.context).length > 0) {
      const depth = this.config("contextDepth") ?? 4;
      console.log(
        colors.slate("  ↳"),
        inspect(data.context, { colors: true, depth, breakLength: 80 }),
      );
    }
  }
}
