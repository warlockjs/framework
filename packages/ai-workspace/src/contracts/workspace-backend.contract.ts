/**
 * Low-level result of a backend command execution. Mirrors the shape the
 * policy-enforced ops layer surfaces as `RunShellResult`, minus the
 * byte-cap `truncated` flag (capping is an ops-layer concern, not the
 * raw executor's).
 */
export interface WorkspaceBackendExecResult {
  /** Process exit code. */
  exitCode: number;
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
  /** True when the command was killed for exceeding its timeout. */
  timedOut: boolean;
  /**
   * True when the invocation's `signal` aborted — either before the
   * command started (nothing was spawned) or while it ran (the process
   * tree was killed). Mutually exclusive with `timedOut`. Optional so
   * existing custom backends keep compiling; absent reads as `false`.
   */
  cancelled?: boolean;
}

/**
 * Options threaded into a backend `exec` call. The ops layer resolves
 * the effective environment and timeout from policy before handing them
 * down — the backend just runs what it is told.
 */
export interface WorkspaceBackendExecOptions {
  /** Working directory for the spawned process (already jail-resolved). */
  cwd?: string;
  /** Wall-clock cap in ms; on expiry the process is SIGKILLed. */
  timeoutMs?: number;
  /** Exact environment for the spawned process (NOT merged with process.env). */
  env?: Record<string, string>;
  /**
   * Per-invocation cancellation. A backend must not start the command when
   * the signal is already aborted, must tear down the whole process tree
   * when it aborts mid-run, must remove its abort listener once the command
   * settles, and reports either case as `cancelled: true` (never a
   * rejection). The signal belongs to ONE call — never cache it on the
   * backend.
   */
  signal?: AbortSignal;
}

/**
 * The swappable executor a workspace runs on — the thin, **policy-agnostic**
 * IO seam the ops layer calls. A backend takes **already-resolved absolute
 * paths** and performs the side effect; it does NOT know about `cwd` jails,
 * allow/deny lists, hashes, or line windows — that enforcement lives one
 * layer up in {@link WorkspaceOps}.
 *
 * Implementations:
 * - **local** — `@warlock.js/fs` for IO + `node:child_process` for `exec`.
 * - **mock** — an in-memory `Map` + scripted `exec`, for hermetic tests.
 *
 * Keeping the backend dumb is what lets the same ops/policy layer run
 * unchanged over a real disk, an in-memory fake, or (later) a container.
 *
 * @example
 * const out = await backend.readFile("/srv/acme-api/src/index.ts");
 * const { exitCode } = await backend.exec("npm test", { cwd: "/srv/acme-api" });
 */
export interface WorkspaceBackend {
  /** Read a file's full UTF-8 content at an absolute path. */
  readFile(absPath: string): Promise<string>;
  /** Write full content to an absolute path (atomically where supported). */
  writeFile(absPath: string, content: string): Promise<void>;
  /** Whether anything exists at an absolute path (file or directory). */
  exists(absPath: string): Promise<boolean>;
  /** Create a directory (and parents) at an absolute path; idempotent. */
  mkdir(absPath: string): Promise<void>;
  /** Remove a file or directory tree at an absolute path. */
  remove(absPath: string): Promise<void>;
  /** List immediate children of an absolute directory as absolute paths. */
  list(absDir: string): Promise<string[]>;
  /** Resolve symlinks/`..` to a canonical absolute path (jail enforcement). */
  realpath(absPath: string): Promise<string>;
  /** Run a command and capture its outcome. */
  exec(
    command: string,
    opts?: WorkspaceBackendExecOptions,
  ): Promise<WorkspaceBackendExecResult>;
}
