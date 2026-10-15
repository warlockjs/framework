import type { AtomicUpdate } from "../../contracts";

/**
 * Translate cascade's driver-agnostic update into MongoDB's native form.
 *
 * Every operator is native except `$dec`, which MongoDB does not have: it is
 * folded into `$inc` with negated amounts. A pipeline (array-form) update is
 * returned untouched.
 *
 * @param update - Operator object or aggregation pipeline
 * @returns The update MongoDB accepts
 */
export function toMongoUpdate(
  update: AtomicUpdate,
): Record<string, unknown> | Record<string, unknown>[] {
  if (Array.isArray(update) || !update.$dec) {
    return update as Record<string, unknown> | Record<string, unknown>[];
  }

  const { $dec, ...rest } = update;
  const increments: Record<string, number> = { ...rest.$inc };

  for (const [field, amount] of Object.entries($dec)) {
    increments[field] = (increments[field] ?? 0) - amount;
  }

  return { ...rest, $inc: increments };
}
