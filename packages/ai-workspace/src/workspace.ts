import path from "node:path";
import { ai, type ToolContract } from "@warlock.js/ai";
import { createLocalBackend } from "./backends/local";
import { createMockBackend } from "./backends/mock";
import { WorkspacePolicyError } from "./errors";
import { createOps } from "./ops";
import { makeEditFileTool } from "./tools/edit-file";
import { makeGlobTool } from "./tools/glob";
import { makeGrepTool } from "./tools/grep";
import { makeReadFileTool } from "./tools/read-file";
import { makeRunShellTool } from "./tools/run-shell";
import { makeRunTestsTool } from "./tools/run-tests";
import { makeWriteFileTool } from "./tools/write-file";
import type {
  EditFileInput,
  EditFileResult,
  GrepResult,
  RunShellResult,
  Workspace,
  WorkspaceBackend,
  WorkspaceOps,
  WorkspacePolicy,
  WorkspaceToolName,
  WorkspaceTools,
} from "./contracts";

/**
 * The full set of tool names a writable workspace vends, in a stable
 * canonical order so `tools.all()` is deterministic.
 */
const ALL_TOOL_NAMES: readonly WorkspaceToolName[] = [
  "readFile",
  "editFile",
  "writeFile",
  "runShell",
  "runTests",
  "grep",
  "glob",
];

/**
 * The subset a {@link Workspace.readonly} projection exposes — the
 * non-mutating tools only. `editFile` / `writeFile` / `runShell` /
 * `runTests` are deliberately omitted so a reviewer agent has no path to
 * change the tree.
 */
const READONLY_TOOL_NAMES: readonly WorkspaceToolName[] = [
  "readFile",
  "grep",
  "glob",
];

/**
 * Choose the dumb IO executor for a policy. `"mock"` selects the
 * in-memory backend (hermetic tests); anything else — including the
 * `"local"` default and an absent `backend` — selects the real-disk
 * local backend.
 */
function selectBackend(policy: WorkspacePolicy): WorkspaceBackend {
  if (policy.backend === "mock") {
    return createMockBackend();
  }

  return createLocalBackend();
}

/**
 * The internal {@link Workspace} implementation. Holds the resolved
 * backend, the policy, and the single shared {@link WorkspaceOps} seam
 * that both the agent-facing `.tools.*` factories and the human-facing
 * direct methods funnel through — one jail, one rule set, two callers.
 *
 * The `allowedTools` set narrows what `tools.*` will vend and which
 * mutating direct methods are permitted: a full workspace allows every
 * name; a {@link WorkspaceImpl.readonly} projection allows only the
 * read/grep/glob subset and rejects writes/edits/shell/mkdir/remove.
 *
 * Constructed via {@link workspace}; the class itself is internal.
 */
class WorkspaceImpl implements Workspace {
  /** The shared, policy-enforced operation layer (jail + guards). */
  private readonly ops: WorkspaceOps;

  /** Tool names this projection is permitted to vend / mutate through. */
  private readonly allowedTools: ReadonlySet<WorkspaceToolName>;

  public readonly policy: WorkspacePolicy;

  public readonly tools: WorkspaceTools;

  public constructor(
    policy: WorkspacePolicy,
    allowedTools: readonly WorkspaceToolName[] = ALL_TOOL_NAMES,
  ) {
    this.policy = policy;
    this.allowedTools = new Set(allowedTools);

    const backend = selectBackend(policy);
    this.ops = createOps(backend, policy);
    this.tools = this.buildTools();
  }

  /**
   * Assemble the agent-facing tool namespace. Each factory builds its
   * tool over the shared `ops`; `all()` returns every *allowed* tool in
   * canonical order and `pick(...)` returns the named subset (silently
   * dropping any name this projection does not allow, so a `readonly()`
   * workspace can never be coaxed into vending a mutating tool).
   */
  private buildTools(): WorkspaceTools {
    // Each `make*Tool` returns a precisely-typed
    // `ToolContract<SpecificInput, SpecificOutput>`, but the agent-facing
    // `WorkspaceTools` surface vends the type-erased `ToolContract`
    // (`ToolContract<unknown, unknown>`). Because `ToolContract` puts its
    // input in a contravariant position (`execute(input)` / `action(input)`),
    // a specific contract is not assignable to the erased one — so erase it
    // once, here, through `unknown`. The runtime object is identical; only
    // the static input type is widened for the shared surface.
    const erase = <TInput, TOutput>(
      contract: ToolContract<TInput, TOutput>,
    ): ToolContract => contract as unknown as ToolContract;

    const factories: Record<
      WorkspaceToolName,
      (opts?: { name?: string; command?: string }) => ToolContract
    > = {
      readFile: (opts) => erase(makeReadFileTool(this.ops, opts)),
      editFile: (opts) => erase(makeEditFileTool(this.ops, opts)),
      writeFile: (opts) => erase(makeWriteFileTool(this.ops, opts)),
      runShell: (opts) => erase(makeRunShellTool(this.ops, opts)),
      runTests: (opts) => erase(makeRunTestsTool(this.ops, opts)),
      grep: (opts) => erase(makeGrepTool(this.ops, opts)),
      glob: (opts) => erase(makeGlobTool(this.ops, opts)),
    };

    const build = (name: WorkspaceToolName, opts?: { name?: string; command?: string }) =>
      factories[name](opts);

    return {
      all: () =>
        ALL_TOOL_NAMES.filter((name) => this.allowedTools.has(name)).map((name) =>
          build(name),
        ),
      pick: (...names: WorkspaceToolName[]) =>
        names.filter((name) => this.allowedTools.has(name)).map((name) => build(name)),
      readFile: (opts) => build("readFile", opts),
      editFile: (opts) => build("editFile", opts),
      writeFile: (opts) => build("writeFile", opts),
      runShell: (opts) => build("runShell", opts),
      runTests: (opts) => build("runTests", opts),
      grep: (opts) => build("grep", opts),
      glob: (opts) => build("glob", opts),
    };
  }

  /**
   * Reject a mutating direct method on a read-only projection — surfaced
   * as a {@link WorkspacePolicyError} (the same typed error a denied
   * command produces) so a caller branches on `error.type`.
   */
  private assertWritable(operation: string): void {
    if (this.allowedTools.has("writeFile")) {
      return;
    }

    throw new WorkspacePolicyError(
      `Operation "${operation}" is not permitted on a read-only workspace.`,
      { type: "denied-command", command: operation },
    );
  }

  public readFile(
    filePath: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<{ content: string; hash: string; totalLines: number }> {
    return this.ops.readFile(filePath, opts);
  }

  public async writeFile(
    filePath: string,
    content: string,
  ): Promise<{ hash: string; bytesWritten: number }> {
    this.assertWritable("writeFile");

    return this.ops.writeFile(filePath, content);
  }

  public async editFile(input: EditFileInput): Promise<EditFileResult> {
    this.assertWritable("editFile");

    return this.ops.editFile(input);
  }

  public async exec(command: string, opts?: { timeoutMs?: number }): Promise<RunShellResult> {
    this.assertWritable("exec");

    return this.ops.exec(command, opts);
  }

  public grep(
    pattern: string,
    opts?: { glob?: string; ignoreCase?: boolean },
  ): Promise<GrepResult> {
    return this.ops.grep(pattern, opts);
  }

  public glob(pattern: string): Promise<string[]> {
    return this.ops.glob(pattern);
  }

  public exists(filePath: string): Promise<boolean> {
    return this.ops.exists(filePath);
  }

  public async mkdir(filePath: string): Promise<void> {
    this.assertWritable("mkdir");

    return this.ops.mkdir(filePath);
  }

  public async remove(filePath: string): Promise<void> {
    this.assertWritable("remove");

    return this.ops.remove(filePath);
  }

  /**
   * A read-only projection over the SAME policy — only the read/grep/glob
   * tools are vended and every mutating direct method rejects with a
   * {@link WorkspacePolicyError}. A fresh ops/backend is built from the
   * identical policy, so the projection sees the same jailed tree.
   */
  public readonly(): Workspace {
    return new WorkspaceImpl(this.policy, READONLY_TOOL_NAMES);
  }

  /**
   * A sub-jailed view rooted at `subdir` (relative to this workspace's
   * `cwd`). Returns a brand-new workspace whose policy is this policy
   * with `cwd` narrowed to `join(cwd, subdir)` — same backend selection,
   * same allow/deny/shell/read sub-policies, but a tighter jail root.
   */
  public scope(subdir: string): Workspace {
    return new WorkspaceImpl(
      { ...this.policy, cwd: path.join(this.policy.cwd, subdir) },
      [...this.allowedTools],
    );
  }
}

/**
 * Build a {@link Workspace} — the integrator that wires a
 * {@link WorkspacePolicy} to a backend, the shared policy-enforced ops
 * layer, and the seven agent-facing tool factories.
 *
 * The backend is chosen from `policy.backend`: `"mock"` runs in memory
 * (hermetic tests); the `"local"` default (and any absent value) runs
 * over the real disk via `@warlock.js/fs` + `node:child_process`. The
 * returned workspace exposes:
 *
 * - **`tools.*`** — `readFile` / `editFile` / `writeFile` / `runShell` /
 *   `runTests` / `grep` / `glob`, plus `all()` (every tool) and
 *   `pick(...)` (a least-privilege subset).
 * - **direct methods** — `readFile` / `writeFile` / `editFile` / `exec` /
 *   `grep` / `glob` / `exists` / `mkdir` / `remove`, each delegating 1:1
 *   to the shared ops layer.
 * - **`readonly()`** — a projection that vends only read/grep/glob and
 *   rejects every mutating direct method.
 * - **`scope(subdir)`** — a sub-jailed workspace rooted at `subdir`.
 *
 * Available at runtime as `ai.workspace(policy)` once this module is
 * imported (it registers the verb on the shared `ai` object).
 *
 * @param policy - The policy bounding the workspace (its `cwd` is the jail root).
 * @returns A fully-wired {@link Workspace}.
 *
 * @example
 * const ws = workspace({ cwd: "/srv/acme-api", shell: { allow: ["npm"], inheritEnv: ["PATH"] } });
 * const dev = ai.agent({ model, tools: ws.tools.all() });
 * await dev.execute("Make the failing cart-total suite green.");
 *
 * @example
 * // Least-privilege reviewer — no write, no shell.
 * const reviewer = ai.agent({ model, tools: ws.readonly().tools.all() });
 */
export function workspace(policy: WorkspacePolicy): Workspace {
  return new WorkspaceImpl(policy);
}

/**
 * Attach the `workspace` verb to the `ai` namespace via module augmentation,
 * per the `ai.`-namespace convention. `@warlock.js/ai` now exposes a named `Ai`
 * interface for exactly this, so after a bare `import "@warlock.js/ai-workspace"`,
 * `ai.workspace(...)` is globally typed — no view/cast needed.
 */
declare module "@warlock.js/ai" {
  interface Ai {
    /** Build a policy-jailed filesystem + shell {@link Workspace}. */
    workspace(policy: WorkspacePolicy): Workspace;
  }
}

// Runtime registration: attach `workspace` onto the shared `ai` object the
// moment this package is imported (the augmentation above types it).
ai.workspace = workspace;
