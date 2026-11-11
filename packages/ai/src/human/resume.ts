import { log } from "@warlock.js/logger";
import type {
  ApprovalDecision,
  InterruptStore,
  PendingInterrupt,
  ResumeOptions,
  ResumeResult,
} from "./contracts";
import { runWithSeededDecision } from "./resume-seed";

/** Whether the "store has no claim()" warning was already logged in this process. */
let warnedMissingClaim = false;

/**
 * Take a pending interrupt so exactly one resume applies it. Uses the
 * store's atomic `claim` when it has one; otherwise falls back to
 * `load` + `delete` (two concurrent resumes can both pass) and logs a
 * one-time warning naming the method to add.
 */
async function claimPending(
  store: InterruptStore,
  interruptId: string,
): Promise<PendingInterrupt | undefined> {
  if (typeof store.claim === "function") {
    return store.claim(interruptId);
  }

  if (!warnedMissingClaim) {
    warnedMissingClaim = true;
    log.warn(
      "ai.human",
      "resume.claim",
      "the interrupt store has no claim() method, so two concurrent resumes of one interrupt can both apply the decision; add claim(interruptId) that removes and returns a pending record in one atomic step",
    );
  }

  const pending = await store.load(interruptId);

  if (pending === undefined || pending.status !== "pending") {
    return undefined;
  }

  await store.delete(interruptId);

  return pending;
}

/**
 * Validate that a decision is a well-formed {@link ApprovalDecision}.
 *
 * `ai.human.resume(...)` is a public, out-of-process entry point — a
 * webhook can hand it anything. Guard the closed `type` union (and the
 * per-variant required fields) before applying it, so a malformed payload
 * fails loudly here rather than silently mis-driving the re-run.
 */
function assertDecision(decision: ApprovalDecision): void {
  if (decision.type === "approve") {
    return;
  }

  if (decision.type === "reject") {
    if (typeof decision.reason !== "string") {
      throw new TypeError("ai.human.resume: a 'reject' decision requires a string 'reason'.");
    }

    return;
  }

  if (decision.type === "edit") {
    if (!("args" in decision)) {
      throw new TypeError("ai.human.resume: an 'edit' decision requires replacement 'args'.");
    }

    return;
  }

  throw new TypeError(
    `ai.human.resume: unknown decision type '${(decision as { type: string }).type}'. Expected one of: approve, reject, edit.`,
  );
}

/**
 * Re-run the agent for a resumed interrupt with the decision pre-seeded.
 *
 * Stages the decision in the process-local seed registry keyed by the
 * interrupt id and the pending action's binding, then re-executes the
 * original prompt inside that seed scope. The agent's
 * `ai.human.approval(...)` middleware consumes the seed on the gated tool
 * call — so this time it resolves to the human's ruling instead of pausing
 * again. The seed is dropped when the re-run settles, so a re-run that
 * errors before the gated call never leaks a stale seed into a later run.
 */
async function rerun<TOutput>(
  pending: PendingInterrupt,
  decision: ApprovalDecision,
  options: ResumeOptions<TOutput>,
): Promise<ResumeResult<TOutput>> {
  const { agent } = options;

  // `agent` is guaranteed by the caller (this is only reached on the
  // re-run path), but narrow for the type system.
  if (!agent) {
    return { type: "applied", interruptId: pending.interruptId, decision };
  }

  const input = options.input ?? pending.request.context.originalInput ?? "";

  // The binding key includes the session, so the re-run must execute in the
  // interrupted run's session unless the caller names one explicitly —
  // otherwise the seed can never match and the call suspends again.
  const sessionId = options.executeOptions?.sessionId ?? pending.request.context.sessionId;
  const executeOptions =
    sessionId === undefined ? options.executeOptions : { ...options.executeOptions, sessionId };

  // The seed is scoped to this re-run: only the gated call made inside
  // `agent.execute` below can take it, never a concurrent execution of the
  // same agent with the same session and arguments.
  const result = await runWithSeededDecision(
    pending.interruptId,
    pending.request.bindingKey,
    decision,
    () => agent.execute(input, executeOptions),
  );

  return {
    type: "applied",
    interruptId: pending.interruptId,
    decision,
    result,
  };
}

/**
 * Apply a human's decision to a persisted interrupt — the out-of-process
 * resume entry point behind `ai.human.resume(interruptId, decision, options)`.
 *
 * **Durable v1 model — re-run, not mid-supervisor suspend.** This loads the
 * {@link PendingInterrupt} from `options.store`, validates the decision,
 * deletes the pending record, and (when an `agent` is supplied) re-executes
 * the original turn with the decision **pre-seeded**, so the gated tool call
 * resolves to the ruling instead of pausing again. It does **not** rehydrate
 * an in-flight supervisor — that is the deferred v2 lift.
 *
 * **Idempotent and exactly-once.** The pending record is taken with the
 * store's atomic `claim`, so of several concurrent resumes of one interrupt
 * (a double-clicked "Approve") exactly one applies the decision. A second
 * resume of an already-resolved (deleted) or never-raised interrupt is a
 * no-op: it returns `{ type: "already-resolved" }` without re-applying the
 * decision or re-running the turn — mirroring the orchestrator resume's
 * drain idempotency. The record is deleted **before**
 * the re-run, so even a re-run that itself raises a fresh interrupt cannot
 * collide with the one being resolved.
 *
 * **Two shapes** (see {@link ResumeOptions}):
 * - **apply-only** — omit `agent`: load, validate, delete, return
 *   `{ type: "applied", decision }` for a caller-owned re-drive.
 * - **re-run** — pass `agent`: additionally re-execute the turn; the
 *   {@link import("@warlock.js/ai").AgentResult} rides `result.result`.
 *
 * @param interruptId - Id of the persisted interrupt to resolve.
 * @param decision - The human's ruling (approve / reject / edit).
 * @param options - The durable `store` (required) plus optional re-run
 *   `agent` / `input` / `executeOptions`.
 * @returns A {@link ResumeResult} — `"applied"` or idempotent
 *   `"already-resolved"`.
 *
 * @example
 * // Process B (webhook, hours later) — apply-only:
 * const outcome = await ai.human.resume(interruptId, { type: "reject", reason: "Out of policy" }, {
 *   store,
 * });
 *
 * @example
 * // Re-run the turn with the decision pre-seeded:
 * const outcome = await ai.human.resume(interruptId, { type: "edit", args: { amount: 5 } }, {
 *   store,
 *   agent: support,
 * });
 * if (outcome.type === "applied" && outcome.result) {
 *   console.log(outcome.result.text);
 * }
 */
export async function resume<TOutput = unknown>(
  interruptId: string,
  decision: ApprovalDecision,
  options: ResumeOptions<TOutput>,
): Promise<ResumeResult<TOutput>> {
  assertDecision(decision);

  // Claim (remove + return in one atomic step) BEFORE the re-run so a re-run
  // that itself raises a new interrupt cannot collide with the one being
  // resolved, and a concurrent resume of the same id gets nothing.
  const pending = await claimPending(options.store, interruptId);

  // No live interrupt — already resolved + deleted, claimed by a concurrent
  // resume, or never raised. Never double-apply; never re-run.
  if (pending === undefined) {
    return { type: "already-resolved", interruptId };
  }

  if (!options.agent) {
    return { type: "applied", interruptId, decision };
  }

  return rerun(pending, decision, options);
}
