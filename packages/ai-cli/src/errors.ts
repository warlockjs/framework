import { type AIErrorOptions, ProviderError } from "@warlock.js/ai";

/**
 * Why a CLI agent refused or failed a run.
 *
 * - `not-found` — the executable is not on `PATH` (or the given path does not exist).
 * - `capability` — the installed CLI's `--help` does not list a flag the run needs.
 * - `probe-failed` — `--help`/`--version` could not be run.
 * - `unsupported-option` — the adapter has no way to honour an option (effort, MCP, home, …).
 * - `prompt-transport` — the prompt fits neither argv nor stdin for this CLI and platform.
 * - `run-failed` — the session ended `failed` or `timeout` (raised by the model adapter).
 */
export type CliErrorType =
  | "not-found"
  | "capability"
  | "probe-failed"
  | "unsupported-option"
  | "prompt-transport"
  | "run-failed";

export type CliErrorOptions = AIErrorOptions & {
  type: CliErrorType;
  /** Adapter name, e.g. `"codex"`. */
  adapter: string;
  /** The missing flag, for `capability`. */
  flag?: string;
  /** Detected CLI version, when known. */
  version?: string;
  /** Resolved executable, when known. */
  executable?: string;
};

/**
 * A CLI agent error. Extends the framework `ProviderError`, so agents,
 * fallbacks and observers treat it like any other provider failure; branch
 * on `error.type` for the specific reason.
 *
 * @example
 * try {
 *   await claude.run("hi");
 * } catch (error) {
 *   if (error instanceof CliError && error.type === "capability") {
 *     console.error(`Upgrade ${error.adapter}: missing ${error.flag} in ${error.version}`);
 *   }
 * }
 */
export class CliError extends ProviderError {
  public readonly type: CliErrorType;
  public readonly adapter: string;
  public readonly flag?: string;
  public readonly version?: string;
  public readonly executable?: string;

  public constructor(message: string, options: CliErrorOptions) {
    super(
      message,
      options,
      options.type === "unsupported-option" || options.type === "prompt-transport"
        ? "PROVIDER_INVALID_REQUEST"
        : "PROVIDER_ERROR",
    );

    this.name = "CliError";
    this.type = options.type;
    this.adapter = options.adapter;
    this.flag = options.flag;
    this.version = options.version;
    this.executable = options.executable;
  }
}
