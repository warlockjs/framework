import { AsyncLocalStorage } from "node:async_hooks";
import type { ApprovalDecision } from "./contracts";

/**
 * Process-local registry of decisions pre-seeded for a durable re-run.
 *
 * **Why it exists.** v1 durable resume re-runs the *same* agent turn with
 * the human's decision already in hand (it does **not** rehydrate an
 * in-flight supervisor — that is the deferred v2 lift). The agent's
 * `ai.human.approval(...)` middleware is baked in at construction, so the
 * re-run cannot be handed a different handler. Instead, `ai.human.resume(...)`
 * stashes the decision here and runs the re-execution inside a seed scope;
 * the approval middleware's handler consults the registry **before** calling
 * the author's handler and, on a hit, replays the seeded decision exactly
 * once — so the gated tool call this time resolves to the human's ruling
 * instead of pausing again.
 *
 * Keyed by the resumed interrupt's id (the scope) **and** the deterministic
 * binding key of the approved action. Only code running inside that
 * re-run's async scope can take the decision: another execution of the same
 * agent with the same session and arguments, running at the same time,
 * reaches its own handler. A different action cannot consume it either.
 */
const seededDecisions = new Map<string, ApprovalDecision>();

/**
 * The seed scope (the resumed interrupt id) of the current async
 * execution, or `undefined` outside a resume re-run.
 */
const seedScope = new AsyncLocalStorage<string>();

/** Registry key for a decision seeded for `bindingKey` inside `scope`. */
function seedKey(scope: string, bindingKey: string): string {
  return `${scope}\u0000${bindingKey}`;
}

/**
 * Run `fn` inside the seed scope `scope` with `decision` staged for the
 * gated call `bindingKey`. The seed is dropped when `fn` settles, so a
 * re-run that errors (or never reaches the gated call) cannot leak it into
 * a later run.
 */
export async function runWithSeededDecision<T>(
  scope: string,
  bindingKey: string,
  decision: ApprovalDecision,
  fn: () => Promise<T>,
): Promise<T> {
  const key = seedKey(scope, bindingKey);

  seededDecisions.set(key, decision);

  try {
    return await seedScope.run(scope, fn);
  } finally {
    seededDecisions.delete(key);
  }
}

/**
 * Take (read **and** remove) the decision seeded for `bindingKey` in the
 * current seed scope, or `undefined` when none is staged or the caller is
 * not running inside a resume re-run. Consuming on read makes the seed
 * one-shot: only the first gated call of a re-run replays it.
 */
export function takeSeededDecision(bindingKey: string): ApprovalDecision | undefined {
  const scope = seedScope.getStore();

  if (scope === undefined) {
    return undefined;
  }

  const key = seedKey(scope, bindingKey);
  const decision = seededDecisions.get(key);

  if (decision === undefined) {
    return undefined;
  }

  seededDecisions.delete(key);

  return decision;
}
