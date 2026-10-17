import type { ReasoningEffort } from "@warlock.js/ai";
import type { CliEndStatus, CliEvent, CliUsage } from "./events.type";
import type { CliPermission } from "./adapter.contract";
import type { CliMcpServers } from "./mcp.type";

/**
 * Where the CLI keeps its config for a run.
 *
 * - `"private"` (default) — a fresh directory (mode 0700) created for the run
 *   and deleted after it. Nothing from your own login leaks in or out;
 *   authenticate with `apiKey` / `env`.
 * - an absolute path — a home you own and keep (for example one you logged
 *   in to once with `CLAUDE_CONFIG_DIR=/srv/claude claude`). The adapter
 *   points its home variable at it; run-scoped files still go to a private
 *   per-run directory.
 * - `"inherit"` — the CLI's normal home of the current user.
 */
export type CliHome = "private" | "inherit" | (string & {});

/** Options shared by a CLI agent's defaults and a single run. */
export type CliRunOptions = {
  /** Working directory of the run. Default: `process.cwd()`. */
  cwd?: string;
  /** Session reference to resume (`done().sessionRef` of an earlier run). */
  resume?: string;
  /** Cancels the run and kills the CLI's whole process tree. */
  signal?: AbortSignal;
  /** Kills the process tree after this many milliseconds (status `timeout`). */
  timeoutMs?: number;
  /** Vendor model id or alias, passed to the CLI's model flag. */
  model?: string;
  /** Reasoning effort, mapped to the vendor's scale. Refused for CLIs without an effort control. */
  effort?: ReasoningEffort;
  /** `"standard"` (default) or `"bypass"` (approve every tool call — opt in only). */
  permission?: CliPermission;
  /** Per-run MCP servers, written to a 0600 config file — never argv. */
  mcp?: CliMcpServers;
  /** Extra environment for the CLI (wins over inherited variables). */
  env?: Record<string, string>;
  /** API key, exported as the adapter's first `apiKeyEnv` variable. Never placed in argv. */
  apiKey?: string;
  /** Extra argv appended after the adapter's own flags. Do not put secrets here. */
  args?: string[];
};

/** Configuration of a CLI agent (`cli.claudeCode({...})`). */
export type CliAgentOptions = CliRunOptions & {
  /** Executable to run instead of the adapter's default (a name on `PATH` or an absolute path). */
  command?: string;
  /** Config home. Default `"private"`. */
  home?: CliHome;
  /**
   * Which of the current process's environment variables the CLI inherits.
   * `true` (default) inherits everything except the adapter's own home
   * variables; `false` passes only a minimal system set (PATH, HOME, TEMP,
   * locale, proxy and Windows system variables); a list passes the minimal
   * set plus those names.
   */
  inheritEnv?: boolean | string[];
  /**
   * Run the capability probe (`--help`/`--version`) before the first run.
   * Default `true`. Turning it off skips the flag check — a CLI version
   * whose flags changed then fails at run time instead of up front.
   */
  probe?: boolean;
  /** Grace period between SIGTERM and SIGKILL when a run is cancelled (POSIX). Default 2000 ms. */
  killGraceMs?: number;
};

/** What `session.done()` resolves to. */
export type CliResult = {
  status: CliEndStatus;
  /** The final answer: the vendor's final record, else the last assistant message. */
  text: string;
  /** Every complete assistant message, in order. */
  messages: string[];
  /** Accumulated usage, or `undefined` when the CLI reported none. */
  usage?: CliUsage;
  /** Pass as `resume` to continue this session. */
  sessionRef?: string;
  exitCode: number | null;
  signal: string | null;
  /** First fatal error, or a summary of stderr when the run failed. */
  error?: string;
  /** The last 64 KiB of stderr. */
  stderr: string;
  durationMs: number;
};

/** A running CLI session. */
export type CliSession = {
  /** Adapter name, e.g. `"claude-code"`. */
  readonly adapter: string;
  /** Process id of the spawned CLI. */
  readonly pid: number | undefined;
  /**
   * The normalized event stream. Every iteration replays from the first
   * event, so several consumers may read it; it ends after `session.ended`.
   */
  readonly events: AsyncIterable<CliEvent>;
  /** Resolves once the process exits and the stream is drained. Never rejects. */
  done(): Promise<CliResult>;
  /** Cancel the run (kills the process tree); `done()` then resolves `cancelled`. */
  cancel(): void;
};

/** Result of the capability probe. */
export type CliProbeResult = {
  /** Resolved executable path. */
  executable: string;
  /** First version-looking token of `--version`, or the trimmed output. */
  version: string;
  /** Concatenated help output the required flags are checked against. */
  help: string;
};
