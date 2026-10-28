import type { ToolContract } from "@warlock.js/ai";
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
  TodoListResult,
  WorkspaceTodoInput,
  WorkspaceToolName,
} from "./tool-io.type";
import type { WorkspacePolicy } from "./workspace-policy.type";

/**
 * The agent-facing tool surface of a workspace. Each factory returns a
 * {@link ToolContract} ready to hand to `ai.agent({ tools })`. `all()`
 * vends every tool; `pick(...)` selects a least-privilege subset (e.g.
 * `pick("readFile", "grep", "glob")` for a read-only reviewer).
 *
 * Every factory takes an optional `{ name }` so the same workspace can
 * expose the same capability under a custom tool name when wiring
 * multiple agents.
 */
export interface WorkspaceTools {
  /**
   * Every tool this workspace vends, as `ToolContract[]`, ready for
   * `ai.agent({ tools })`. `shell_output` / `shell_kill` are included only
   * when the policy enables background commands (`shell.background`).
   */
  all(): ToolContract[];
  /** A named subset, e.g. `pick("readFile", "grep")` for least privilege. */
  pick(...names: WorkspaceToolName[]): ToolContract[];
  /** The `read_file` tool. */
  readFile(opts?: { name?: string }): ToolContract;
  /** The `edit_file` tool (exact-string replace + stale-hash guard). */
  editFile(opts?: { name?: string }): ToolContract;
  /** The `multi_edit` tool (several replacements in one file, all or none). */
  multiEdit(opts?: { name?: string }): ToolContract;
  /** The `apply_patch` tool (a unified diff across files: modify, create, delete, rename; all or none). */
  applyPatch(opts?: { name?: string }): ToolContract;
  /** The `write_file` tool (atomic full-content write). */
  writeFile(opts?: { name?: string }): ToolContract;
  /** The `list_dir` tool (bounded, jailed directory listing). */
  listDir(opts?: { name?: string }): ToolContract;
  /** The `run_shell` tool (policy-gated command execution, optionally in the background). */
  runShell(opts?: { name?: string }): ToolContract;
  /** The `shell_output` tool (read a background command's new output). */
  shellOutput(opts?: { name?: string }): ToolContract;
  /** The `shell_kill` tool (stop a background command). */
  shellKill(opts?: { name?: string }): ToolContract;
  /** The `run_tests` tool (runs the configured test command). */
  runTests(opts?: { name?: string; command?: string }): ToolContract;
  /** The `grep` tool (regex content search). */
  grep(opts?: { name?: string }): ToolContract;
  /** The `glob` tool (path pattern match). */
  glob(opts?: { name?: string }): ToolContract;
  /** The `todo_write` tool (replace the workspace's todo list). */
  todoWrite(opts?: { name?: string }): ToolContract;
  /** The `todo_read` tool (read the workspace's todo list). */
  todoRead(opts?: { name?: string }): ToolContract;
}

/**
 * The bounded place an agent reads, writes, and runs commands — a
 * policy-enforced handle to a filesystem + shell. One policy, one shared
 * ops layer, two ways to touch it: the agent uses `.tools.*`; you use the
 * direct methods.
 *
 * The surface: the policy jail, the tools, the direct methods,
 * `tools.all()` / `tools.pick()`, the two composition projections
 * `readonly()` and `scope()`, background commands, a todo list, and
 * `dispose()`. Projections share their parent's background commands and
 * todo list; disposing any of them disposes the whole workspace.
 *
 * @example
 * const ws = ai.workspace({ cwd: "/srv/acme-api", shell: { allow: ["npm"], inheritEnv: ["PATH"] } });
 * const dev = ai.agent({ model, tools: ws.tools.all() });
 * await dev.execute("Make the failing cart-total suite green.");
 *
 * @example
 * // Drive it directly from code.
 * await ws.writeFile("src/routes.ts", BOILERPLATE);
 * const files = await ws.glob("src/models/**\/*.ts");
 */
export interface Workspace {
  /** The immutable policy bounding this workspace. */
  readonly policy: WorkspacePolicy;

  /** Agent-facing tool factories. */
  readonly tools: WorkspaceTools;

  /**
   * Read a jailed file. `offset`/`limit` select a 1-based line window and
   * `read.maxBytes` bounds the returned bytes; returns the numbered content,
   * the full file's SHA-256 `hash` (for read-before-edit), and the window
   * metadata — the same shape the `read_file` tool returns.
   */
  readFile(path: string, opts?: { offset?: number; limit?: number }): Promise<ReadFileResult>;

  /** Atomically write full content to a jailed path. */
  writeFile(path: string, content: string): Promise<{ hash: string; bytesWritten: number }>;

  /** Apply an exact-string edit under the read-before-edit stale guard. */
  editFile(input: EditFileInput): Promise<EditFileResult>;

  /** Apply several exact-string edits to one file — all of them or none. */
  multiEdit(input: MultiEditInput): Promise<MultiEditResult>;

  /** Apply a unified diff (modify, create, delete, rename) to the workspace — all of it or none. */
  applyPatch(input: ApplyPatchInput): Promise<ApplyPatchResult>;

  /** List a jailed directory (bounded, ignores applied, symlinks not followed). */
  listDir(path?: string, opts?: ListDirOptions): Promise<ListDirResult>;

  /**
   * Run a policy-gated shell command and capture its outcome. `signal`
   * cancels this one call: not started when already aborted, process tree
   * killed when it aborts mid-run, `cancelled: true` either way.
   */
  exec(command: string, opts?: ExecOptions): Promise<RunShellResult>;

  /**
   * Start a policy-checked background command owned by this workspace
   * (needs `shell.background`). It runs until it exits, `shellKill(id)`,
   * its timeout, or `dispose()`.
   */
  startShell(command: string, opts?: StartShellOptions): Promise<ShellJobInfo>;

  /** New output of a background command since `since` (default: the last read). */
  shellOutput(id: string, opts?: ShellOutputOptions): Promise<ShellOutputResult>;

  /** Kill a background command's whole process tree. */
  shellKill(id: string): Promise<ShellJobInfo>;

  /** Every background command this workspace knows, oldest first. */
  listShells(): ShellJobInfo[];

  /** The workspace's todo list (what `todo_read` returns). */
  readTodos(): TodoListResult;

  /** Replace the workspace's todo list (what `todo_write` does). */
  writeTodos(todos: WorkspaceTodoInput[]): TodoListResult;

  /**
   * Close the workspace: kill every background command's process tree and
   * refuse new commands (a foreground command already running finishes on
   * its own, or by its timeout / signal). Idempotent; resolves once the
   * background processes are gone.
   */
  dispose(): Promise<void>;

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
   * A read-only projection of this workspace — the same jail and state,
   * but the write/edit/shell tools are omitted from `tools.*` and the
   * mutating direct methods reject. For least-privilege reviewers.
   */
  readonly(): Workspace;

  /**
   * A sub-jailed view rooted at `subdir` (relative to this workspace's
   * `cwd`), sharing the same backend. Narrows the blast radius — e.g.
   * `ws.scope("packages/api")` jails an agent to that package.
   */
  scope(subdir: string): Workspace;
}
