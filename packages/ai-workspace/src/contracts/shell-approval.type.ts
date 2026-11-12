import type { WorkspaceCommandPattern } from "./workspace-policy.type";

/** What a command rule does to a command that matches it. */
export type WorkspaceCommandDecision = "allow" | "ask" | "deny";

/**
 * One entry of `shell.rules`.
 *
 * @example
 * { match: "git push", effect: "ask", reason: "Pushing publishes work." }
 */
export interface WorkspaceCommandRule {
  /**
   * A string matches a command whose argv starts with those tokens (the
   * executable compared by basename); a RegExp is tested against the argv
   * joined with single spaces. Same semantics as `denyPatterns`.
   */
  match: WorkspaceCommandPattern;
  /** What happens to a matching command. */
  effect: WorkspaceCommandDecision;
  /** Shown to the model when the command is denied, and to the owner in an ask. */
  reason?: string;
}

/** Why a command is waiting for a decision. */
export type WorkspaceShellAskReason =
  /** It matched an `ask` rule, or matched no rule while `onAsk` is set. */
  | "rule"
  /** The line uses syntax the policy cannot read, so no command in it can be checked. */
  | "unparsed"
  /** It runs another command the policy cannot see into (`bash -c`, `xargs`, `iex`, …). */
  | "nested"
  /**
   * It sets a variable that can make an allowed program run another program or
   * load code (`NODE_OPTIONS=… cmd`, `env PATH=… cmd`, `export GIT_PAGER=…`,
   * `read PATH`, `printf -v PATH`, `getopts spec PATH`). `variable` names it.
   */
  | "assignment";

/** One command (or unreadable line) `shell.onAsk` is asked about. */
export interface WorkspaceShellAsk {
  /** The command's argv; for an `"unparsed"` ask, the whole line as one element. */
  argv: readonly string[];
  /** The `ask` rule that matched, when one did. */
  rule?: WorkspaceCommandRule;
  /** Why it is being asked about. */
  reason: WorkspaceShellAskReason;
  /**
   * The variable the command sets, exactly as written. Present only when
   * `reason` is `"assignment"`; add it to `shell.allowAssignments` to stop
   * asking about it.
   */
  variable?: string;
}

/** What `shell.onAsk` is told: one call per line, covering every ask in it. */
export interface WorkspaceShellAskRequest {
  /** The full command line. */
  command: string;
  /** Every simple command that needs a decision (never empty). */
  asks: readonly WorkspaceShellAsk[];
  /** The invocation's cancellation signal, when it has one. */
  signal?: AbortSignal;
}

/**
 * The host's decision. `allow: false` refuses the line (reason
 * `"approval-denied"`). `remember` adds a session allow rule for that
 * pattern — shared with the workspace's `readonly()` and `scope()` views,
 * lower than any configured deny, and above an `ask` rule.
 */
export interface WorkspaceShellAskDecision {
  allow: boolean;
  /**
   * One pattern or several (a line such as `git status -s && npm test` asks
   * about two commands). Each is added once; list them with
   * `workspace.shell.remembered()` and remove one with `forget(pattern)`.
   */
  remember?: WorkspaceCommandPattern | readonly WorkspaceCommandPattern[];
  /**
   * Why the line was refused (used when `allow` is `false`). Appended to the
   * refusal the model reads, cut at 500 characters with a `[truncated]` marker.
   */
  reason?: string;
}

/**
 * Decides on commands that need approval. A throw or a rejection refuses the
 * line (fail closed).
 *
 * @example
 * onAsk: async ({ asks }) => ({ allow: await confirm(asks[0].argv.join(" ")), remember: "git push" })
 */
export type WorkspaceShellOnAsk = (
  request: WorkspaceShellAskRequest,
) => Promise<WorkspaceShellAskDecision>;

/**
 * What `workspace.shell.classify(line)` returns: the simple commands the
 * line would run, in order, without running or checking anything.
 */
export interface WorkspaceShellClassification {
  /** The argv of every simple command (substitutions and pipeline members included). */
  commands: string[][];
  /** Set when the line could not be read with confidence: why. `commands` is then empty. */
  opaque?: string;
}
