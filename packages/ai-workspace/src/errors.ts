import { AIError, type AIErrorOptions } from "@warlock.js/ai";

/**
 * Why a workspace policy check rejected an operation.
 *
 * - `"path-escape"` — a resolved path fell outside the `cwd` jail (or an
 *   `allowPaths` root), or matched a `denyPaths` glob.
 * - `"denied-command"` — a shell command's leading executable basename
 *   was not in `shell.allow`, or was explicitly in `shell.deny`.
 * - `"unsafe-pattern"` — a `grep` pattern was too long or matched a
 *   catastrophic-backtracking shape (nested quantifiers) that could hang
 *   the process (ReDoS).
 */
export type WorkspacePolicyViolation = "path-escape" | "denied-command" | "unsafe-pattern";

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

  public constructor(message: string, options: WorkspacePolicyErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "WorkspacePolicyError";
    this.type = options.type;
    this.path = options.path;
    this.command = options.command;
    this.pattern = options.pattern;
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
 */
export type WorkspaceEditFailure = "not-found" | "not-unique" | "stale-hash";

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

  public constructor(message: string, options: WorkspaceEditErrorOptions) {
    super("TOOL_EXEC_FAILED", message, options);

    this.name = "WorkspaceEditError";
    this.type = options.type;
    this.path = options.path;
    this.matches = options.matches;
    this.expectedHash = options.expectedHash;
    this.actualHash = options.actualHash;
  }
}
