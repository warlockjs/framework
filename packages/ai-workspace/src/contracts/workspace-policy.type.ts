/**
 * The executor a workspace runs on. `"local"` uses `@warlock.js/fs` +
 * `node:child_process` against the real filesystem under `cwd`;
 * `"mock"` uses an in-memory backend (for hermetic, disk-free tests).
 *
 * The worktree and container backends from the design doc are deferred
 * past the W1 surface and intentionally absent from this union.
 */
export type WorkspaceBackendType = "local" | "mock";

/**
 * Shell-execution sub-policy for `run_shell` / `run_tests` and the
 * `exec()` direct method.
 *
 * **Command gating.** Each command is tokenized into an argv (quotes
 * respected, NO shell semantics) and executed without a shell; a command
 * containing unquoted shell metacharacters (`;`, `&`, `|`, backticks,
 * `$`, redirection, parentheses) is denied outright, so metacharacters
 * cannot chain extra commands past the gate. The argv's leading
 * executable basename is matched against `allow` / `deny`; **deny wins**
 * when a name appears in both. An empty/absent `allow` means no command
 * is permitted unless the policy explicitly opts in — the workspace is
 * fail-closed.
 *
 * **Environment.** The spawned process does NOT inherit `process.env`.
 * The effective environment is `{ ...pick(process.env, inheritEnv), ...env }`
 * — so `run_shell` cannot find `node`/`npm` unless `inheritEnv` includes
 * `"PATH"`. This is deliberate isolation, documented loudly.
 */
export interface WorkspaceShellPolicy {
  /** Allowed executable basenames (e.g. `["npm", "node"]`). */
  allow?: string[];
  /** Denied executable basenames — wins over `allow`. */
  deny?: string[];
  /** Per-command wall-clock cap; on expiry the process is SIGKILLed. */
  timeoutMs?: number;
  /** Max bytes captured from stdout/stderr before output is truncated. */
  maxOutputBytes?: number;
  /** Explicit environment variables injected into every spawned process. */
  env?: Record<string, string>;
  /**
   * Opt-in passthrough of named `process.env` keys (e.g. `["PATH"]`).
   * Nothing from `process.env` leaks in unless listed here.
   */
  inheritEnv?: string[];
}

/**
 * Read sub-policy controlling how much of a file a single read returns.
 * Applies equally to the `read_file` tool and the `readFile()` direct method.
 */
export interface WorkspaceReadPolicy {
  /**
   * Hard cap on the UTF-8 bytes of the `content` a single read returns,
   * line-number prefixes and newlines included. A window that would exceed
   * it is cut — mid-line if needed, always on a character boundary — and
   * the result reports `bytesCapped: true`. Absent ⇒ no byte cap. The
   * whole file is still read and hashed; this bounds what is returned.
   */
  maxBytes?: number;
  /** Default number of lines a read returns when no explicit limit is given. */
  defaultLines?: number;
}

/**
 * The full policy that bounds a workspace — the single source of truth
 * the policy engine enforces for both `.tools.*` and the direct methods.
 *
 * **Path jail.** Every path is `realpath`-resolved and must sit under
 * `cwd` (or an `allowPaths` root); `denyPaths` globs are blocked even
 * inside `cwd` (e.g. `.git/**`, `.env*`). A path that escapes the jail
 * surfaces as a `WorkspacePolicyError`, returned to the agent as tool
 * data — never a thrown run-killer.
 *
 * @example
 * const policy: WorkspacePolicy = {
 *   cwd: "/srv/acme-api",
 *   denyPaths: [".git/**", ".env*"],
 *   shell: { allow: ["npm", "node"], inheritEnv: ["PATH"], timeoutMs: 60_000 },
 *   read: { maxBytes: 256_000, defaultLines: 2_000 },
 *   backend: "local",
 * };
 */
export interface WorkspacePolicy {
  /** Absolute jail root — the workspace cannot read or write outside it. */
  cwd: string;
  /** Extra readable roots outside `cwd` (resolved absolute paths). */
  allowPaths?: string[];
  /** Globs blocked even inside `cwd` (deny wins over allow). */
  denyPaths?: string[];
  /** Shell-execution sub-policy. Absent ⇒ no command may run. */
  shell?: WorkspaceShellPolicy;
  /** Read sub-policy (byte cap + default line window). */
  read?: WorkspaceReadPolicy;
  /** Executor the workspace runs on. Defaults to `"local"`. */
  backend?: WorkspaceBackendType;
}
