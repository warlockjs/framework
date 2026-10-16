import type {
  EditFileInput,
  EditFileResult,
  ExecOptions,
  GrepResult,
  ReadFileResult,
  RunShellResult,
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
   * Run a shell command after gating its leading executable basename
   * against the shell allow/deny policy, with the policy environment,
   * timeout, and output byte cap applied. `signal` cancels this one call
   * (see {@link ExecOptions}).
   */
  exec(command: string, opts?: ExecOptions): Promise<RunShellResult>;

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
}
