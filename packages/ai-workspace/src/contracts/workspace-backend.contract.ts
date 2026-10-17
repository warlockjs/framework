import type { WorkspaceShellInterpreter } from "./workspace-policy.type";

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
  /**
   * How to run `command`: `"none"` (default) tokenizes it into an argv and
   * spawns it without a shell; `"sh"` hands the whole line to `/bin/sh -c`
   * (`cmd.exe /d /v:off /s /c` on Windows). The ops layer has already
   * checked every command in the line against the policy; a backend that
   * does not support `"sh"` must refuse the command rather than run it
   * another way.
   */
  interpreter?: WorkspaceShellInterpreter;
}

/** Which stream a background command's output chunk came from. */
export type WorkspaceOutputStream = "stdout" | "stderr";

/** Options for {@link WorkspaceBackend.start}. */
export interface WorkspaceBackendStartOptions {
  /** Working directory for the spawned process (already jail-resolved). */
  cwd?: string;
  /** Exact environment for the spawned process (NOT merged with process.env). */
  env?: Record<string, string>;
  /** See {@link WorkspaceBackendExecOptions.interpreter}. */
  interpreter?: WorkspaceShellInterpreter;
  /**
   * Receives output as it arrives, decoded as UTF-8 and never split inside a
   * character. Called synchronously or later — never after `done` settles.
   */
  onOutput(stream: WorkspaceOutputStream, chunk: string): void;
}

/** A running background command, as a backend hands it to the ops layer. */
export interface WorkspaceBackendProcess {
  /** OS process id of the direct child, when there is one. */
  readonly pid?: number;
  /**
   * Settles once the process has exited and its output has been delivered.
   * Never rejects: a spawn failure resolves with exit code `127`.
   */
  readonly done: Promise<{ exitCode: number }>;
  /** Kill the whole process tree. Idempotent; safe after it has exited. */
  kill(): void;
}

/** What {@link WorkspaceBackend.stat} reports about a path (symlinks are not followed). */
export interface WorkspaceBackendStat {
  /** Entry kind. */
  type: "file" | "directory" | "symlink" | "other";
  /** Size in bytes. */
  size: number;
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
  exec(command: string, opts?: WorkspaceBackendExecOptions): Promise<WorkspaceBackendExecResult>;
  /**
   * Describe an absolute path without following a final symlink. Optional:
   * without it, `list_dir` tells files from directories by trying to list
   * them and reports no sizes.
   */
  stat?(absPath: string): Promise<WorkspaceBackendStat>;
  /**
   * Start a long-running command and return at once. Optional: without it,
   * background commands are refused. The process must be its own process
   * group (or equivalent) so `kill()` reaches every descendant.
   */
  start?(command: string, opts: WorkspaceBackendStartOptions): WorkspaceBackendProcess;
}
