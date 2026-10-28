import type { ApprovalHandler, ApprovalRemember, InterruptPolicy } from "./approval.type";
import type { InterruptStore } from "./interrupt-store.contract";

/**
 * Options for `ai.human.approval(options)` — the `tool.before`
 * approval-gate middleware factory.
 *
 * The middleware evaluates {@link HumanApprovalOptions.policy} against
 * each pending tool call; for gated calls it builds an
 * {@link import("./approval.type").ApprovalRequest} and routes it to
 * {@link HumanApprovalOptions.handler}, then applies the returned
 * {@link import("./approval.type").ApprovalDecision} (approve → continue;
 * reject → short-circuit a typed error; edit → run with replaced args).
 */
export type ToolApprovalMode = "allow" | "deny" | "ask";

/** Where remembered approvals are kept. Implement it to persist them. */
export interface ApprovalMemory {
  /** Whether this exact entry was approved for the session. */
  has(sessionId: string, entry: ApprovalMemoryEntry): boolean | Promise<boolean>;
  /** Record an approval for the session. */
  add(sessionId: string, entry: ApprovalMemoryEntry): void | Promise<void>;
  /** Forget every approval of the session. */
  clear(sessionId: string): void | Promise<void>;
}

/** One remembered approval: a whole tool, or a tool with exact arguments. */
export type ApprovalMemoryEntry = {
  type: ApprovalRemember;
  toolName: string;
  /** Stable serialization of the arguments; present for `type: "args"`. */
  argsKey?: string;
};

export type RememberApprovalsOptions = {
  /** Storage for remembered approvals. Default: an in-process memory. */
  memory?: ApprovalMemory;
};

export interface HumanApprovalOptions {
  /**
   * Stable middleware name. Middleware names are validated unique per
   * agent, so two approval middlewares on one agent need distinct names.
   * Defaults to `"human-approval"`.
   */
  name?: string;

  /**
   * Which tool calls require a human. Optional when `tools` or
   * `defaultMode` says what to do with every call; when both are given,
   * a `tools` entry for the tool wins and the policy decides for the rest.
   */
  policy?: InterruptPolicy;

  /**
   * Per-tool mode: `"allow"` runs the tool without asking, `"deny"`
   * refuses it (the model sees an {@link import("../errors").ApprovalRejectedError}),
   * `"ask"` routes the call to the handler. A tool listed here ignores
   * `policy`.
   *
   * @example
   * humanApproval({
   *   tools: { read_file: "allow", delete_file: "deny", run_shell: "ask" },
   *   handler,
   * });
   */
  tools?: Record<string, ToolApprovalMode>;

  /**
   * Mode for tools that neither `tools` nor `policy` covers. With a
   * `policy`, the policy decides those instead (gated means `"ask"`,
   * the rest `"allow"`). Without one, the default is `"ask"`.
   */
  defaultMode?: ToolApprovalMode;

  /** Reason the model is told when a call is denied by mode. */
  denyReason?: string;

  /**
   * Remember approvals for the rest of the session. When the handler
   * approves with `{ type: "approve", remember: "tool" }` (or `"args"`),
   * later calls in the same session skip the handler. Needs a
   * `sessionId` on the run (`agent.execute(input, { sessionId })`);
   * calls without one are always asked. `true` keeps memory in process.
   */
  remember?: true | RememberApprovalsOptions;

  /** How a gated call reaches a human and yields a decision. */
  handler: ApprovalHandler;

  /**
   * Optional durable store. When set **and** the handler throws
   * {@link import("../errors").InterruptSuspendedError}, the pending
   * request is persisted here for out-of-process resume via
   * `ai.human.resume(interruptId, decision)`. Omit for pure interactive
   * (await-in-process) mode.
   */
  store?: InterruptStore;
}
