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
 * How `run_shell` / `exec()` interpret a command line.
 *
 * - `"none"` (default) — **argv mode**: the line is tokenized into one argv
 *   (quotes respected, no shell semantics) and spawned without a shell. Any
 *   unquoted shell operator is refused with a message that says how to split
 *   the line.
 * - `"sh"` — **shell mode** (explicit opt-in): the line runs through
 *   `/bin/sh -c` (`cmd.exe /d /v:off /s /c` on Windows). Before it runs, the
 *   line is parsed and every simple command in it — inside `;`, `&&`, `||`,
 *   pipes, subshells, `$( )` and backticks — is checked against the same
 *   `deny` / `allow` / `denyPatterns` / `allowCommand` rules, and every
 *   redirection target and `cd` directory against the path jail. Syntax the
 *   parser cannot read with confidence is refused, never guessed at.
 */
export type WorkspaceShellInterpreter = "none" | "sh";

/**
 * A command pattern in `shell.denyPatterns`.
 *
 * - A **string** is tokenized like a command and matches a command whose
 *   argv **starts with** those tokens — the executable compared by basename,
 *   case-insensitively. `"git push --force"` matches
 *   `git push --force origin main` but not `git push origin --force`.
 * - A **RegExp** is tested against the command's argv joined with single
 *   spaces, the executable reduced to its basename (`/usr/bin/git  push`
 *   is tested as `"git push"`). Use it for option orders and spellings:
 *   `/^git push\b.*(--force|-f\b)/`. A `g`/`y` flag is ignored.
 */
export type WorkspaceCommandPattern = string | RegExp;

/** What {@link WorkspaceAllowCommand} is told about the command it checks. */
export interface WorkspaceCommandCheckContext {
  /** The full command line the checked command is part of. */
  command: string;
  /** The interpreter the line runs under. */
  interpreter: WorkspaceShellInterpreter;
  /**
   * True when the argv is a command run through a wrapper the policy
   * unwrapped (`time npm test` is checked as `["time", "npm", "test"]` and
   * then as the nested `["npm", "test"]`) or by `find -exec`.
   */
  nested: boolean;
}

/**
 * A host predicate over every simple command's argv. Return `true` to let
 * the command through, `false` to refuse it, or a string to refuse it with
 * that explanation (shown to the model). A throw refuses the command too —
 * the hook fails closed. It can only narrow what `allow` / `deny` permit,
 * never widen it, and it must be synchronous.
 *
 * @example
 * allowCommand: (argv) =>
 *   argv[0] === "git" && argv[1] === "push" ? "Pushing is done by the release job." : true
 */
export type WorkspaceAllowCommand = (
  argv: readonly string[],
  context: WorkspaceCommandCheckContext,
) => boolean | string;

/**
 * Background-command sub-policy. Present ⇒ `run_shell({ background: true })`
 * and `startShell()` may start long-running commands (dev servers,
 * watchers) that belong to the workspace; absent ⇒ background commands are
 * refused. Every background command is killed — its whole process tree —
 * by `workspace.dispose()`, and when the Node process exits.
 */
export interface WorkspaceBackgroundPolicy {
  /** Most background commands running at once. Default `4`. */
  maxJobs?: number;
  /**
   * Wall-clock cap for one background command, after which its process tree
   * is killed (`status: "timed-out"`). Default: none — it runs until killed
   * or disposed. A model-supplied `timeoutMs` can only lower it.
   */
  timeoutMs?: number;
}

/**
 * Shell-execution sub-policy for `run_shell` / `run_tests` and the
 * `exec()` direct method.
 *
 * **Command gating.** By default (`interpreter: "none"`) each command is
 * tokenized into an argv (quotes respected, NO shell semantics) and executed
 * without a shell; a command containing unquoted shell metacharacters (`;`,
 * `&`, `|`, backticks, `$`, redirection, parentheses) is refused with a
 * message that names the operator and suggests the split. With
 * `interpreter: "sh"` the line runs through a shell, and every simple
 * command in it is checked. Each command's executable basename is matched
 * against `allow` / `deny`; **deny wins** (and matches case-insensitively).
 * A non-empty `allow` is exhaustive. `denyPatterns` and `allowCommand`
 * then refine the decision per argv. A command that would run another
 * command out of the policy's sight (`bash -c`, `eval`, `xargs`, `sudo`, …)
 * is refused when the policy has deny rules, unless it is named in `allow`.
 *
 * **Environment.** The spawned process does NOT inherit `process.env`.
 * The effective environment is `{ ...pick(process.env, inheritEnv), ...env }`
 * — so `run_shell` cannot find `node`/`npm` unless `inheritEnv` includes
 * `"PATH"`. This is deliberate isolation, documented loudly. Shell mode also
 * drops the variables that change how a shell parses or starts (`ENV`,
 * `BASH_ENV`, `SHELLOPTS`, `BASHOPTS`, `CDPATH`, `IFS`, `PS4`, `BASH_FUNC_*`).
 */
export interface WorkspaceShellPolicy {
  /** Allowed executable basenames (e.g. `["npm", "node"]`). */
  allow?: string[];
  /** Denied executable basenames — wins over `allow`. */
  deny?: string[];
  /**
   * Argument-level denials checked against every simple command (see
   * {@link WorkspaceCommandPattern}), e.g. `["rm -rf /", "git push --force"]`.
   */
  denyPatterns?: WorkspaceCommandPattern[];
  /**
   * Host predicate over every simple command's argv (see
   * {@link WorkspaceAllowCommand}).
   */
  allowCommand?: WorkspaceAllowCommand;
  /**
   * How the command line is interpreted. Default `"none"` (argv mode, no
   * shell). `"sh"` is an explicit opt-in to shell syntax — pipes, `&&`,
   * redirections — still checked per simple command (see
   * {@link WorkspaceShellInterpreter}).
   */
  interpreter?: WorkspaceShellInterpreter;
  /** Per-command wall-clock cap; on expiry the process is SIGKILLed. */
  timeoutMs?: number;
  /**
   * Max bytes captured from stdout/stderr before output is truncated. For a
   * background command it is the most output kept per command; older output
   * is dropped first.
   */
  maxOutputBytes?: number;
  /** Explicit environment variables injected into every spawned process. */
  env?: Record<string, string>;
  /**
   * Opt-in passthrough of named `process.env` keys (e.g. `["PATH"]`).
   * Nothing from `process.env` leaks in unless listed here.
   */
  inheritEnv?: string[];
  /**
   * Enables background commands (see {@link WorkspaceBackgroundPolicy}).
   * Absent ⇒ `run_shell({ background: true })` is refused.
   */
  background?: WorkspaceBackgroundPolicy;
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
 * Directory-listing sub-policy for the `list_dir` tool and `listDir()`.
 * `denyPaths` are always hidden from listings; `ignore` hides more without
 * blocking access (an ignored file can still be read).
 */
export interface WorkspaceListPolicy {
  /**
   * Globs (`*`, `**`, `?`; a bare name also hides its contents) left out of
   * listings. Default `["node_modules", ".git"]`; setting it replaces the
   * default.
   */
  ignore?: string[];
  /** Deepest `depth` a listing may ask for. Default `5`. */
  maxDepth?: number;
  /** Most entries one listing returns; the rest set `truncated`. Default `500`. */
  maxEntries?: number;
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
  /** Directory-listing sub-policy (ignore globs + bounds). */
  list?: WorkspaceListPolicy;
  /** Executor the workspace runs on. Defaults to `"local"`. */
  backend?: WorkspaceBackendType;
}
