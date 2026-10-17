import type { ReasoningEffort } from "@warlock.js/ai";
import type { CliParsedEvent } from "./events.type";
import type { CliMcpServers } from "./mcp.type";

/**
 * Permission mode for a run.
 *
 * - `standard` (default) — the CLI's own non-interactive approval rules: tools
 *   that would need a human approval are refused, never auto-approved.
 * - `bypass` — every tool call is approved without asking (each vendor's
 *   "yolo"/"dangerously skip permissions" switch). Opt in per agent or per run.
 */
export type CliPermission = "standard" | "bypass";

/**
 * How the prompt reaches the CLI: as an argv element, written to stdin, or
 * written to a file in the run directory whose path is passed (for CLIs
 * with a `--prompt-file` flag).
 */
export type CliPromptTransport = "argv" | "stdin" | "file";

/**
 * Everything an adapter needs to build one launch. Built by the runner;
 * adapters only read it.
 */
export type CliLaunchContext = {
  prompt: string;
  /** Where the prompt must go for this plan. */
  transport: CliPromptTransport;
  /** Absolute working directory of the run. */
  cwd: string;
  model?: string;
  /** Requested reasoning effort; the adapter maps it to the vendor's scale. */
  effort?: ReasoningEffort;
  permission: CliPermission;
  /** Session reference to resume (from a previous `session.started` / `done().sessionRef`). */
  resume?: string;
  mcp?: CliMcpServers;
  /**
   * The run's API key. The runner already exports it as the adapter's first
   * `apiKeyEnv` variable; an adapter only reads it when its CLI insists on a
   * key file (written into a private home, mode 0600).
   */
  apiKey?: string;
  /**
   * The CLI's config home for this run, or `undefined` when the run uses
   * the CLI's normal home (`home: "inherit"`).
   */
  home?: string;
  /**
   * `true` when `home` was created for this run and is deleted afterwards —
   * the adapter may write home-level config files (for example Codex's
   * `config.toml`) into it. `false` for a caller-owned or inherited home.
   */
  homeIsPrivate: boolean;
  /** A private directory (mode 0700) for run-scoped files; deleted after the run. */
  runDir: string;
  platform: NodeJS.Platform;
};

/** A file the runner writes (mode 0600, parent directories 0700) before spawning. */
export type CliLaunchFile = {
  /** Absolute path, inside `context.runDir` or a private `context.home`. */
  path: string;
  content: string;
};

/** What an adapter returns for one launch. */
export type CliLaunchPlan = {
  /** argv after the executable (subcommand and flags). */
  args: string[];
  /**
   * argv that must come last, after any caller `args` — typically the
   * positional prompt (`transport: "argv"`).
   */
  tail?: string[];
  /** Text written to stdin before it is closed (the prompt, for `transport: "stdin"`). */
  stdin?: string;
  /** Environment the CLI needs on top of the inherited one (config home variables, …). */
  env?: Record<string, string>;
  /** Files to write before spawning (MCP config, …). */
  files?: CliLaunchFile[];
  /**
   * The flags (and subcommands) this plan relies on, spelled as `--help`
   * prints them. The capability probe requires each one; a missing entry
   * fails the run before anything is spawned.
   */
  requires: string[];
};

/** How the capability probe reads the CLI's help and version. */
export type CliProbeSpec = {
  /** Each entry is one help invocation; their outputs are searched together. */
  help: string[][];
  /** Version invocation. */
  version: string[];
};

/** Where an adapter's flags and stream format were verified, recorded per adapter. */
export type CliAdapterVerification = {
  /** CLI version the adapter was checked against. */
  version: string;
  /** `help` — checked against the real `--help` output; `docs` — official docs/source only. */
  verifiedBy: "help" | "docs";
  /** Official documentation / source URLs. */
  sources: string[];
  /** ISO date of the check. */
  checkedAt: string;
};

/**
 * A stateful parser for one session's stdout. The runner feeds it complete
 * lines (without the trailing newline) and calls `end()` once stdout closes.
 */
export type CliStreamParser = {
  line(line: string): CliParsedEvent[];
  end(): CliParsedEvent[];
  /**
   * The session reference, for CLIs that reveal it only at the end of the
   * stream (after `session.started` was emitted). Read once the stream
   * closes; wins over a ref from `session.started`.
   */
  sessionRef?(): string | undefined;
};

/**
 * A vendor adapter: the launch plan and the stream parser for one coding
 * CLI. Implement this to drive a CLI the package does not ship.
 *
 * @example
 * const myCli: CliAdapter = {
 *   name: "my-cli",
 *   title: "My CLI",
 *   command: "my-cli",
 *   apiKeyEnv: ["MY_CLI_API_KEY"],
 *   homeEnv: ["MY_CLI_HOME"],
 *   transports: ["argv"],
 *   probe: { help: [["--help"]], version: ["--version"] },
 *   verification: { version: "1.2.0", verifiedBy: "help", sources: ["https://example.com/docs"], checkedAt: "2026-10-17" },
 *   plan: (context) => ({
 *     args: ["--print", "--json"],
 *     tail: [context.prompt],
 *     env: context.home ? { MY_CLI_HOME: context.home } : undefined,
 *     requires: ["--print", "--json"],
 *   }),
 *   parser: () => jsonLinesParser((record) =>
 *     record.type === "text" ? [{ type: "message", text: String(record.text), delta: false }] : [],
 *   ),
 * };
 */
export type CliAdapter = {
  /** Stable id, e.g. `"claude-code"`. Used in errors and as the model provider name. */
  readonly name: string;
  /** Human name, e.g. `"Claude Code"`. */
  readonly title: string;
  /** Default executable name looked up on `PATH`. */
  readonly command: string;
  /** Environment variables that receive an API key (the first is used for the `apiKey` option). */
  readonly apiKeyEnv: readonly string[];
  /**
   * Environment variables pointed at the config home. Empty when the CLI
   * cannot relocate its config, in which case `home` other than `"inherit"`
   * is refused for it.
   */
  readonly homeEnv: readonly string[];
  /** Prompt transports the CLI accepts, in order of preference. */
  readonly transports: readonly CliPromptTransport[];
  /** Whether the adapter maps `effort` to a vendor flag. */
  readonly effort?: boolean;
  /** Whether the adapter can attach per-run MCP servers. */
  readonly mcp?: boolean;
  readonly probe: CliProbeSpec;
  readonly verification: CliAdapterVerification;
  plan(context: CliLaunchContext): CliLaunchPlan;
  /**
   * A fresh parser for one session. Receives the launch context of the
   * chosen plan, so a parser can read a file the CLI writes into
   * `context.runDir` when its stream ends.
   */
  parser(context: CliLaunchContext): CliStreamParser;
};
