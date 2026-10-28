import { AIError, type AIErrorOptions } from "@warlock.js/ai";

/**
 * Why a workspace policy check rejected an operation.
 *
 * - `"path-escape"` — a resolved path fell outside the `cwd` jail (or an
 *   `allowPaths` root), or matched a `denyPaths` glob.
 * - `"denied-command"` — the shell policy refused a command line (`reason`
 *   says why: an executable outside `shell.allow` or inside `shell.deny`, a
 *   metacharacter in argv mode, a redirection outside the jail in shell
 *   mode, …), or a mutating method was called on a read-only projection.
 * - `"unsafe-pattern"` — a `grep` pattern was too long or matched a
 *   catastrophic-backtracking shape (nested quantifiers) that could hang
 *   the process (ReDoS).
 */
export type WorkspacePolicyViolation = "path-escape" | "denied-command" | "unsafe-pattern";

/**
 * Why the shell policy refused a command. Set on every
 * {@link WorkspacePolicyError} of type `"denied-command"` raised for a
 * command line, so a host can phrase the refusal itself instead of parsing
 * the message.
 *
 * - `"metacharacter"` — argv mode (the default `interpreter: "none"`) met an
 *   unquoted shell operator (`&&`, `;`, `|`, `>`, `$`, backticks, …). The
 *   message suggests how to split the line into separate commands.
 * - `"unbalanced-quotes"` — a quote is never closed.
 * - `"denied-executable"` — a command's executable is listed in `shell.deny`.
 * - `"not-allowed"` — a command's executable is not in `shell.allow`, the
 *   `shell.allowCommand` hook refused it, the workspace has no shell policy,
 *   the line is empty, or background commands are not enabled.
 * - `"denied-pattern"` — a command matched one of `shell.denyPatterns`.
 * - `"nested-command"` — a command runs another command the policy cannot
 *   inspect (`bash -c …`, `eval`, `xargs`, `sudo`, a wrapper with options the
 *   policy cannot read), while the policy has deny rules it would bypass.
 * - `"unsupported-syntax"` — shell mode (`interpreter: "sh"`) met syntax the
 *   policy does not parse with confidence (compound commands, arithmetic,
 *   brace expansion, background `&`, a command name decided at run time, …),
 *   so the line is refused rather than guessed at.
 * - `"path-escape"` — shell mode: a redirection target or `cd` directory
 *   resolves outside the workspace jail or hits `denyPaths`.
 */
export type WorkspaceShellRefusalReason =
  | "metacharacter"
  | "unbalanced-quotes"
  | "denied-executable"
  | "not-allowed"
  | "denied-pattern"
  | "nested-command"
  | "unsupported-syntax"
  | "path-escape";

/**
 * Options for {@link WorkspacePolicyError} — the structured `type`
 * discriminator plus, where relevant, the offending path or command for
 * branchable diagnostics without parsing the message.
 */
export type WorkspacePolicyErrorOptions = AIErrorOptions & {
  /** Which policy rule was violated. */
  type: WorkspacePolicyViolation;
  /** The offending workspace-relative path (for `"path-escape"`). */
  path?: string;
  /** The offending command line (for `"denied-command"`). */
  command?: string;
  /** The offending regex pattern (for `"unsafe-pattern"`). */
  pattern?: string;
  /** Why the shell policy refused the command (for `"denied-command"`). */
  reason?: WorkspaceShellRefusalReason;
  /** The executable the refusal is about, when there is one. */
  executable?: string;
};

/**
 * The workspace policy engine refused an operation — a path escaped the
 * jail (or hit a deny glob), or a shell command's executable was not
 * allowed.
 *
 * **Surface.** This is returned to the agent as tool-error *data*, never
 * a thrown run-killer — the agent reads the failure and self-corrects.
 * Extends the framework `AIError` (category `"tool"`, code
 * `TOOL_EXEC_FAILED`) so it flows through the same typed error contract
 * as every other AI error; branch on `error.type` for the specific
 * violation.
 *
 * @example
 * if (error instanceof WorkspacePolicyError && error.type === "denied-command") {
 *   console.warn(`Blocked command: ${error.command}`);
 * }
 */
export class WorkspacePolicyError extends AIError {
  /** Which policy rule was violated. */
  public readonly type: WorkspacePolicyViolation;
  /** The offending path, when the violation was a path escape. */
  public readonly path?: string;
  /** The offending command, when the violation was a denied command. */
  public readonly command?: string;
  /** The offending regex pattern, when the violation was `"unsafe-pattern"`. */
  public readonly pattern?: string;
  /**
   * Why the shell policy refused a command line — set on every
   * `"denied-command"` refusal of a command (see
   * {@link WorkspaceShellRefusalReason}).
   */
  public readonly reason?: WorkspaceShellRefusalReason;
  /** The executable the shell refusal is about, when there is one. */
  public readonly executable?: string;

  public constructor(message: string, options: WorkspacePolicyErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "WorkspacePolicyError";
    this.type = options.type;
    this.path = options.path;
    this.command = options.command;
    this.pattern = options.pattern;
    this.reason = options.reason;
    this.executable = options.executable;
  }
}

/**
 * Why an edit was rejected.
 *
 * - `"not-found"` — the `oldString` did not appear in the file.
 * - `"not-unique"` — `oldString` matched more than once and `replaceAll`
 *   was not set, so the edit is ambiguous.
 * - `"stale-hash"` — the file's current hash did not match the supplied
 *   `expectHash`; the file changed since it was read.
 * - `"patch-invalid"` — `applyPatch` was given text that is not a usable
 *   unified diff (or one that is too large).
 * - `"hunk-failed"` — a patch hunk's context is not in the file; `hunkIndex`
 *   names it.
 * - `"binary-file"` — the patch, or a file it touches, is binary.
 * - `"file-exists"` — the patch creates (or renames onto) a path that
 *   already exists.
 * - `"file-missing"` — the patch modifies, renames or deletes a path that
 *   does not exist.
 */
export type WorkspaceEditFailure =
  | "not-found"
  | "not-unique"
  | "stale-hash"
  | "patch-invalid"
  | "hunk-failed"
  | "binary-file"
  | "file-exists"
  | "file-missing";

/**
 * Options for {@link WorkspaceEditError} — the structured `type`
 * discriminator plus optional match-count / hash context for the
 * `"not-unique"` and `"stale-hash"` cases.
 */
export type WorkspaceEditErrorOptions = AIErrorOptions & {
  /** Why the edit was rejected. */
  type: WorkspaceEditFailure;
  /** The edited file's workspace-relative path. */
  path: string;
  /** How many times `oldString` matched (for `"not-unique"`). */
  matches?: number;
  /** The hash the caller expected (for `"stale-hash"`). */
  expectedHash?: string;
  /** The file's actual current hash (for `"stale-hash"`). */
  actualHash?: string;
  /** 0-based index of the failing edit, for a `multiEdit` rejection. */
  editIndex?: number;
  /** 0-based index of the hunk that failed, for an `applyPatch` rejection. */
  hunkIndex?: number;
};

/**
 * An `editFile` operation was rejected by the read-before-edit guard:
 * the `oldString` was absent, matched non-uniquely without `replaceAll`,
 * or the file's hash no longer matched the supplied `expectHash`.
 *
 * **Surface.** Like {@link WorkspacePolicyError}, returned to the agent
 * as tool-error *data* so it can re-read and retry. Extends `AIError`
 * (category `"tool"`, code `TOOL_EXEC_FAILED`); branch on `error.type`.
 *
 * @example
 * if (error instanceof WorkspaceEditError && error.type === "stale-hash") {
 *   // re-read the file and retry the edit with the fresh hash
 * }
 */
export class WorkspaceEditError extends AIError {
  /** Why the edit was rejected. */
  public readonly type: WorkspaceEditFailure;
  /** The edited file's workspace-relative path. */
  public readonly path: string;
  /** How many times `oldString` matched, for the `"not-unique"` case. */
  public readonly matches?: number;
  /** The hash the caller expected, for the `"stale-hash"` case. */
  public readonly expectedHash?: string;
  /** The file's actual current hash, for the `"stale-hash"` case. */
  public readonly actualHash?: string;
  /**
   * For a `multiEdit` rejection, the 0-based index of the edit that failed.
   * Nothing was written: a multi-edit applies all of its edits or none.
   */
  public readonly editIndex?: number;
  /**
   * For an `applyPatch` rejection, the 0-based index of the hunk that failed
   * within its file. Nothing was written.
   */
  public readonly hunkIndex?: number;

  public constructor(message: string, options: WorkspaceEditErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "WorkspaceEditError";
    this.type = options.type;
    this.path = options.path;
    this.matches = options.matches;
    this.expectedHash = options.expectedHash;
    this.actualHash = options.actualHash;
    this.editIndex = options.editIndex;
    this.hunkIndex = options.hunkIndex;
  }
}

/**
 * Why a background-command operation failed.
 *
 * - `"not-found"` — no background command with that id exists in this
 *   workspace (it never existed, or it finished long enough ago to be
 *   pruned).
 */
export type WorkspaceJobFailure = "not-found";

/** Options for {@link WorkspaceJobError}. */
export type WorkspaceJobErrorOptions = AIErrorOptions & {
  /** Why the operation failed. */
  type: WorkspaceJobFailure;
  /** The background command id the caller asked for. */
  jobId: string;
};

/**
 * A `shell_output` / `shell_kill` call (or `shellOutput()` / `shellKill()`)
 * named a background command this workspace does not know. Returned to the
 * agent as tool-error data like the other workspace errors.
 *
 * @example
 * if (error instanceof WorkspaceJobError && error.type === "not-found") {
 *   console.warn(`No background command ${error.jobId}`);
 * }
 */
export class WorkspaceJobError extends AIError {
  /** Why the operation failed. */
  public readonly type: WorkspaceJobFailure;
  /** The background command id the caller asked for. */
  public readonly jobId: string;

  public constructor(message: string, options: WorkspaceJobErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "WorkspaceJobError";
    this.type = options.type;
    this.jobId = options.jobId;
  }
}
