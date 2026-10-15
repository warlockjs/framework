/**
 * Input/output shapes for the seven workspace tools and the direct
 * methods that back them. These are the wire contracts the agent sees
 * (via each tool's schema) and the values the policy-enforced ops layer
 * returns. Paths in every `*Input` are workspace-relative; the policy
 * engine resolves them against `cwd` and rejects escapes.
 */

/**
 * The discriminating set of tool names a workspace can vend, used by
 * `tools.pick(...)` to select a least-privilege subset.
 */
export type WorkspaceToolName =
  | "readFile"
  | "editFile"
  | "writeFile"
  | "runShell"
  | "runTests"
  | "grep"
  | "glob";

/** Input to the `read_file` tool / `readFile()` direct method. */
export interface ReadFileInput {
  /** Workspace-relative path to read. */
  path: string;
  /** 1-based line to start from. Omit to start at the top. */
  startLine?: number;
  /** Max lines to return from `startLine`. Omit for the policy default. */
  limit?: number;
}

/**
 * Result of a read — the requested line window plus the metadata an
 * agent needs to read-before-edit (the `hash` feeds `editFile`'s
 * `expectHash` stale-guard). The `read_file` tool and the `readFile()`
 * direct method return the same shape for the same arguments.
 *
 * `content` is `cat -n` numbered and is bounded by the policy's
 * `read.maxBytes`, measured in UTF-8 bytes of `content` itself (line-number
 * prefixes and newlines included). When the cap cuts the window, the last
 * returned line may be partial — clipped on a character boundary, never
 * mid-character — and `bytesCapped` is `true`.
 */
export interface ReadFileResult {
  /** The returned, line-numbered file content for the requested window. */
  content: string;
  /** 1-based first line requested. */
  startLine: number;
  /**
   * 1-based last line included in `content` (possibly partially, when
   * `bytesCapped`). Below `startLine` when the window is empty.
   */
  endLine: number;
  /** Total line count of the underlying file. */
  totalLines: number;
  /**
   * True when anything after `content` was withheld: lines past `endLine`
   * (line `limit`, policy default window or byte cap) or the tail of
   * `endLine` itself (byte cap).
   */
  truncated: boolean;
  /** True when `read.maxBytes` cut the window short. */
  bytesCapped: boolean;
  /** UTF-8 byte length of the full file. */
  totalBytes: number;
  /**
   * SHA-256 of the **full** file content at read time — not of the returned
   * window — so it stays valid as an `editFile` `expectHash` whatever window
   * or byte cap was applied.
   */
  hash: string;
}

/**
 * Input to the `edit_file` tool / `editFile()` direct method — an
 * exact-string replacement with a read-before-edit stale guard.
 */
export interface EditFileInput {
  /** Workspace-relative path to edit. */
  path: string;
  /** Exact substring to replace; must be unique unless `replaceAll`. */
  oldString: string;
  /** Replacement text. */
  newString: string;
  /** Replace every occurrence instead of requiring a single unique match. */
  replaceAll?: boolean;
  /** Expected current SHA-256; a mismatch rejects the edit as stale. */
  expectHash?: string;
}

/** Result of a successful edit. */
export interface EditFileResult {
  /** Workspace-relative path that was edited. */
  path: string;
  /** Number of occurrences replaced. */
  replacements: number;
  /** SHA-256 of the file content after the edit. */
  hash: string;
}

/** Input to the `write_file` tool / `writeFile()` direct method. */
export interface WriteFileInput {
  /** Workspace-relative path to write (created if absent). */
  path: string;
  /** Full file content to write atomically. */
  content: string;
}

/** Result of a write. */
export interface WriteFileResult {
  /** Workspace-relative path that was written. */
  path: string;
  /** Number of bytes written. */
  bytesWritten: number;
  /** SHA-256 of the written content. */
  hash: string;
}

/** Options for the `exec()` direct method. */
export interface ExecOptions {
  /** Per-call wall-clock cap in ms; overrides the policy `shell.timeoutMs`. */
  timeoutMs?: number;
  /**
   * Cancels this one command. Already aborted: the command is not started.
   * Aborted mid-run: its process tree is killed. Either way the result has
   * `cancelled: true`. The tools pass the agent run's signal here.
   */
  signal?: AbortSignal;
}

/** Input to the `run_shell` tool / `exec()` direct method. */
export interface RunShellInput {
  /** The command line to run; its leading basename is policy-checked. */
  command: string;
  /** Per-call wall-clock cap (overrides the policy default if lower). */
  timeoutMs?: number;
}

/** Result of a shell command — captured streams plus how it terminated. */
export interface RunShellResult {
  /** Process exit code (non-zero ⇒ the command failed, not the tool). */
  exitCode: number;
  /** Captured standard output (byte-capped per policy). */
  stdout: string;
  /** Captured standard error (byte-capped per policy). */
  stderr: string;
  /** True when stdout/stderr was clipped at the policy byte cap. */
  truncated: boolean;
  /** True when the command was SIGKILLed for exceeding its timeout. */
  timedOut: boolean;
  /**
   * True when the invocation's `signal` aborted: before start (nothing ran)
   * or mid-run (the process tree was killed). Never true together with
   * `timedOut`.
   */
  cancelled: boolean;
}

/**
 * Input to the `run_tests` tool. Convenience over `run_shell` that runs
 * the workspace's configured test command, optionally narrowed to a
 * pattern (a path/suite filter passed through to the runner).
 */
export interface RunTestsInput {
  /** Optional path/name filter forwarded to the test runner. */
  pattern?: string;
}

/** Input to the `grep` tool / `grep()` direct method. */
export interface GrepInput {
  /** Regular-expression pattern to search file contents for. */
  pattern: string;
  /** Glob narrowing which files are scanned (e.g. `"src/api/*.ts"`). */
  glob?: string;
  /** Case-insensitive matching when true. */
  ignoreCase?: boolean;
}

/** A single matched line within a file. */
export interface GrepMatch {
  /** Workspace-relative path of the file containing the match. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  /** Full text of the matching line. */
  text: string;
}

/** Result of a content search across the jailed file set. */
export interface GrepResult {
  /** Every matching line found, in file/line order. */
  matches: GrepMatch[];
  /** Total number of matches (== `matches.length` unless capped). */
  total: number;
}

/** Input to the `glob` tool / `glob()` direct method. */
export interface GlobInput {
  /** Glob pattern resolved relative to `cwd` (e.g. `"src/api/*.ts"`). */
  pattern: string;
}

/** Result of a glob — the matched workspace-relative paths. */
export interface GlobResult {
  /** Workspace-relative paths matching the pattern, sorted. */
  paths: string[];
}
