import type {
  ApplyPatchInput,
  ApplyPatchResult,
  EditFileInput,
  EditFileResult,
  ExecOptions,
  GrepResult,
  ListDirOptions,
  ListDirResult,
  MultiEditInput,
  MultiEditResult,
  ReadFileResult,
  RunShellResult,
  ShellJobInfo,
  ShellOutputOptions,
  ShellOutputResult,
  StartShellOptions,
} from "./tool-io.type";

/**
 * The **policy-enforced** operation layer that sits between the dumb
 * {@link WorkspaceBackend} and the two public callers — the agent-facing
 * `.tools.*` factories and the human-facing direct methods. Both share
 * this single instance, so there is exactly one jail and one set of
 * rules regardless of who calls.
 *
 * Every method here resolves workspace-relative paths against `cwd`,
 * applies the path allow/deny jail, gates shell commands, enforces read
 * caps and the read-before-edit stale-hash guard, then delegates the raw
 * IO to the backend. Policy violations surface as typed errors
 * (`WorkspacePolicyError` / `WorkspaceEditError`), which the tool layer
 * turns into agent-visible tool-error data rather than thrown
 * run-killers.
 *
 * @example
 * const { content, hash } = await ops.readFile("src/index.ts");
 * await ops.editFile({ path: "src/index.ts", oldString: "x", newString: "y", expectHash: hash });
 */
export interface WorkspaceOps {
  /**
   * Read a jailed file, returning a numbered line window, the full file's
   * hash and the window metadata. `offset`/`limit` select a 1-based line
   * window; `read.maxBytes` bounds the UTF-8 bytes of the returned
   * `content` (see {@link ReadFileResult}).
   */
  readFile(path: string, opts?: { offset?: number; limit?: number }): Promise<ReadFileResult>;

  /** Atomically write full content to a jailed path, returning size + hash. */
  writeFile(path: string, content: string): Promise<{ hash: string; bytesWritten: number }>;

  /**
   * Apply an exact-string edit under the read-before-edit guard:
   * rejects on a non-unique `oldString` (unless `replaceAll`) or a
   * stale `expectHash`.
   */
  editFile(input: EditFileInput): Promise<EditFileResult>;

  /**
   * Apply several exact-string edits to one file atomically: each edit runs
   * against the result of the previous ones, under the same uniqueness rules
   * as `editFile`, and the file is written once — or, when any edit fails,
   * not at all (`WorkspaceEditError` with `editIndex`).
   */
  multiEdit(input: MultiEditInput): Promise<MultiEditResult>;

  /**
   * Apply a unified diff that may modify, create, delete and rename several
   * files. Every path goes through the jail, binary files are refused, and
   * the patch is atomic: all hunks apply (and are written, with a rollback if
   * a write fails) or nothing changes. `dryRun` checks without writing.
   * Optional: a custom implementation that omits it gets a generic one built
   * on `exists`, `readFile`, `writeFile` and `remove` (see `applyPatchWithOps`).
   */
  applyPatch?(input: ApplyPatchInput): Promise<ApplyPatchResult>;

  /**
   * Run a command line after checking every command in it against the
   * shell policy (see `WorkspaceShellPolicy`), with the policy environment,
   * timeout, and output byte cap applied. `signal` cancels this one call
   * (see {@link ExecOptions}).
   */
  exec(command: string, opts?: ExecOptions): Promise<RunShellResult>;

  /**
   * Start a policy-checked command as a background job owned by the
   * workspace and return at once. Needs `shell.background`.
   */
  startShell(command: string, opts?: StartShellOptions): Promise<ShellJobInfo>;

  /** New output of a background command since `since` (default: the last read). */
  shellOutput(id: string, opts?: ShellOutputOptions): Promise<ShellOutputResult>;

  /** Kill a background command's whole process tree and report its final state. */
  shellKill(id: string): Promise<ShellJobInfo>;

  /** Every background command this workspace knows, oldest first. */
  listShells(): ShellJobInfo[];

  /**
   * List a jailed directory — bounded by depth and `list.maxEntries`, with
   * `denyPaths` and `list.ignore` left out and symlinks never followed.
   */
  listDir(path?: string, opts?: ListDirOptions): Promise<ListDirResult>;

  /** Search jailed file contents for a regex pattern. */
  grep(pattern: string, opts?: { glob?: string; ignoreCase?: boolean }): Promise<GrepResult>;

  /** Resolve a glob to matching workspace-relative paths within the jail. */
  glob(pattern: string): Promise<string[]>;

  /** Whether a jailed path exists (file or directory). */
  exists(path: string): Promise<boolean>;

  /** Create a directory (and parents) at a jailed path; idempotent. */
  mkdir(path: string): Promise<void>;

  /** Remove a file or directory tree at a jailed path. */
  remove(path: string): Promise<void>;

  /**
   * Kill every background command (whole process trees) and refuse new
   * commands. A foreground command already running finishes on its own (or
   * by its timeout / signal). Idempotent.
   */
  dispose(): Promise<void>;
}
