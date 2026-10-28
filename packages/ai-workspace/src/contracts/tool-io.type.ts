/**
 * Input/output shapes for the workspace tools and the direct
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
  | "multiEdit"
  | "applyPatch"
  | "writeFile"
  | "listDir"
  | "runShell"
  | "shellOutput"
  | "shellKill"
  | "runTests"
  | "grep"
  | "glob"
  | "todoWrite"
  | "todoRead";

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

/** One replacement inside a {@link MultiEditInput}. */
export interface MultiEditOperation {
  /** Exact substring to replace; must be unique unless `replaceAll`. */
  oldString: string;
  /** Replacement text. */
  newString: string;
  /** Replace every occurrence instead of requiring a single unique match. */
  replaceAll?: boolean;
}

/**
 * Input to the `multi_edit` tool / `multiEdit()` direct method — several
 * exact-string replacements in one file, applied in order (each edit sees
 * the result of the previous ones) and written once. All of them apply or
 * none do.
 */
export interface MultiEditInput {
  /** Workspace-relative path to edit. */
  path: string;
  /** The replacements, applied in order. At least one. */
  edits: MultiEditOperation[];
  /** Expected current SHA-256 of the file; a mismatch rejects every edit as stale. */
  expectHash?: string;
}

/** Result of a successful multi-edit. */
export interface MultiEditResult {
  /** Workspace-relative path that was edited. */
  path: string;
  /** Number of edits applied (always `edits.length`). */
  edits: number;
  /** Total occurrences replaced across every edit. */
  replacements: number;
  /** SHA-256 of the file content after all edits. */
  hash: string;
}

/**
 * Input to the `apply_patch` tool / `applyPatch()` direct method — a unified
 * diff (plain or `git diff` style) that may modify, create, delete and rename
 * several files. It applies completely or not at all.
 */
export interface ApplyPatchInput {
  /** The unified diff text. */
  patch: string;
  /** Check that every hunk applies, and report what would change, without writing anything. */
  dryRun?: boolean;
}

/** What a patch did (or, on a dry run, would do) to one file. */
export interface ApplyPatchFileResult {
  /** Workspace-relative path after the change (the removed path for a delete). */
  path: string;
  /** What happened to the file. */
  action: "modified" | "created" | "deleted" | "renamed";
  /** The previous path, for a rename. */
  oldPath?: string;
  /** Number of hunks applied. */
  hunks: number;
  /** SHA-256 of the file after the change; absent for a delete. */
  hash?: string;
}

/** Result of a successful patch. */
export interface ApplyPatchResult {
  /** Per-file outcome, in patch order. */
  files: ApplyPatchFileResult[];
  /** True when nothing was written because `dryRun` was set. */
  dryRun: boolean;
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
  /** The command line to run; every command in it is policy-checked. */
  command: string;
  /** Per-call wall-clock cap (overrides the policy default if lower). */
  timeoutMs?: number;
  /**
   * Start the command as a background job and return its id at once,
   * instead of waiting for it. Needs `shell.background` in the policy.
   */
  background?: boolean;
}

/**
 * Lifecycle state of a background command.
 *
 * - `"running"` — still running.
 * - `"exited"` — finished on its own; `exitCode` holds its exit code.
 * - `"killed"` — stopped by `shell_kill` / `shellKill()` or `dispose()`.
 * - `"timed-out"` — killed for exceeding `shell.background.timeoutMs` (or
 *   the per-call `timeoutMs`).
 */
export type ShellJobStatus = "running" | "exited" | "killed" | "timed-out";

/** A background command owned by the workspace. */
export interface ShellJobInfo {
  /** Workspace-unique id (`"job-1"`, `"job-2"`, …) for `shell_output` / `shell_kill`. */
  id: string;
  /** The command line it runs. */
  command: string;
  /** Lifecycle state. */
  status: ShellJobStatus;
  /** Exit code once it has stopped; `null` while running. */
  exitCode: number | null;
  /** OS process id of the direct child, when the backend has one. */
  pid?: number;
  /** ISO timestamp it was started. */
  startedAt: string;
  /** ISO timestamp it stopped, once it has. */
  endedAt?: string;
}

/** What `run_shell` returns when called with `background: true`. */
export interface RunShellBackgroundResult extends ShellJobInfo {
  /** Always `true` — tells this result apart from a foreground {@link RunShellResult}. */
  background: true;
}

/** Options for `startShell()`. */
export interface StartShellOptions {
  /**
   * Wall-clock cap for this background command, in ms. Lowers
   * `shell.background.timeoutMs` (never raises it); absent ⇒ the policy
   * value, or no cap.
   */
  timeoutMs?: number;
}

/** Input to the `shell_output` tool. */
export interface ShellOutputInput {
  /** The background command id `run_shell` returned. */
  id: string;
  /**
   * Return only output produced after this `cursor` (from an earlier
   * result). Omit to get everything since the previous read.
   */
  since?: number;
  /**
   * Wait up to this many ms (capped at 30 000) for new output or for the
   * command to stop, when there is nothing new yet.
   */
  waitMs?: number;
}

/** Options for `shellOutput()`. */
export interface ShellOutputOptions {
  /** See {@link ShellOutputInput.since}. */
  since?: number;
  /** See {@link ShellOutputInput.waitMs}. */
  waitMs?: number;
  /** Stops a `waitMs` wait early. */
  signal?: AbortSignal;
}

/** New output of a background command plus its current state. */
export interface ShellOutputResult extends ShellJobInfo {
  /** Standard output produced after `since`. */
  stdout: string;
  /** Standard error produced after `since`. */
  stderr: string;
  /**
   * Total bytes the command has produced so far (both streams). Pass it as
   * `since` to read only what comes next.
   */
  cursor: number;
  /**
   * Bytes produced after `since` that are no longer kept (the per-command
   * buffer holds the newest `shell.maxOutputBytes`).
   */
  droppedBytes: number;
  /** True when `droppedBytes > 0`. */
  truncated: boolean;
}

/** Input to the `shell_kill` tool. */
export interface ShellKillInput {
  /** The background command id to stop. */
  id: string;
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

/** Input to the `list_dir` tool. */
export interface ListDirInput {
  /** Workspace-relative directory to list. Default `"."` (the root). */
  path?: string;
  /** How many levels deep to list (1 = direct children). Default `1`. */
  depth?: number;
  /** Extra globs to leave out, on top of `list.ignore` and `denyPaths`. */
  ignore?: string[];
}

/** Options for `listDir()`. */
export interface ListDirOptions {
  /** See {@link ListDirInput.depth}. */
  depth?: number;
  /** See {@link ListDirInput.ignore}. */
  ignore?: string[];
}

/** Kind of a listed entry. A symlink is reported, never followed. */
export type ListDirEntryType = "file" | "directory" | "symlink" | "other";

/** One entry of a directory listing. */
export interface ListDirEntry {
  /** Workspace-relative path (absolute for a directory outside `cwd` in `allowPaths`). */
  path: string;
  /** Entry kind. */
  type: ListDirEntryType;
  /** Size in bytes, for files (when the backend reports it). */
  size?: number;
  /** 1 for a direct child of the listed directory, 2 for a grandchild, … */
  depth: number;
}

/** Result of a directory listing. */
export interface ListDirResult {
  /** The listed directory, workspace-relative (`"."` for the root). */
  path: string;
  /** Entries, breadth-first, each level sorted by name. */
  entries: ListDirEntry[];
  /** True when `list.maxEntries` cut the listing short. */
  truncated: boolean;
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

/** State of one todo item. */
export type WorkspaceTodoStatus = "pending" | "in_progress" | "completed";

/** One item of the workspace's todo list. */
export interface WorkspaceTodo {
  /** Stable id (assigned `"1"`, `"2"`, … when the writer omits it). */
  id: string;
  /** What the step is. */
  content: string;
  /** Its state. */
  status: WorkspaceTodoStatus;
}

/** One item as written by `todo_write` / `writeTodos()` — `id` is optional. */
export interface WorkspaceTodoInput {
  /** Stable id; omit to have one assigned from the item's position. */
  id?: string;
  /** What the step is (non-empty, at most 1 000 characters). */
  content: string;
  /** Its state. */
  status: WorkspaceTodoStatus;
}

/** Input to the `todo_write` tool — the whole new list, replacing the old one. */
export interface TodoWriteInput {
  /** The complete list (at most 100 items). An empty list clears it. */
  todos: WorkspaceTodoInput[];
}

/** The todo list plus a count per status. */
export interface TodoListResult {
  /** Every item, in order. */
  todos: WorkspaceTodo[];
  /** How many items are in each status. */
  counts: Record<WorkspaceTodoStatus, number>;
}
