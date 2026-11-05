import { AgentExecutionError } from "../errors";

/**
 * When a token-based rule (compaction, context editing) starts. A number is
 * an absolute input size. The object form is relative to the model's context
 * window (`capabilities.contextWindow`): the threshold is
 * `floor(window * share)`, lowered to `window - reserve` and to `max` when
 * those are set, and never below 1. With an unknown window the object form
 * does not fire.
 *
 * @example
 * { share: 0.85 }                                // 170K on a 200K window, 850K on 1M
 * { share: 0.9, reserve: 16_000 }                // 128K window: min(115_200, 112_000)
 * { share: 0.8, max: 400_000 }                   // never later than 400K
 */
export type TokenTrigger = number | { share: number; reserve?: number; max?: number };

/** Whether `trigger` is a well-formed {@link TokenTrigger}. */
export function isValidTokenTrigger(trigger: unknown): trigger is TokenTrigger {
  if (typeof trigger === "number") return Number.isSafeInteger(trigger) && trigger > 0;

  if (!trigger || typeof trigger !== "object") return false;

  const { share, reserve, max } = trigger as Record<string, unknown>;

  return (
    typeof share === "number" &&
    share > 0 &&
    share <= 1 &&
    (reserve === undefined || (Number.isSafeInteger(reserve) && (reserve as number) >= 0)) &&
    (max === undefined || (Number.isSafeInteger(max) && (max as number) > 0))
  );
}

/** Throw the authoring error for a malformed trigger. */
export function assertTokenTrigger(trigger: unknown, label: string): void {
  if (!isValidTokenTrigger(trigger)) {
    throw new AgentExecutionError(
      `${label} must be a positive integer or { share: 0..1, reserve?, max? }.`,
      { context: { authoring: true } },
    );
  }
}

/**
 * Resolve a trigger to an absolute token threshold. Returns `undefined` when
 * the trigger is window-relative and the window is unknown.
 */
export function resolveTokenTrigger(
  trigger: TokenTrigger,
  contextWindow: number | undefined,
): number | undefined {
  if (typeof trigger === "number") return trigger;

  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return undefined;
  }

  let threshold = Math.floor(contextWindow * trigger.share);

  if (trigger.reserve !== undefined)
    threshold = Math.min(threshold, contextWindow - trigger.reserve);
  if (trigger.max !== undefined) threshold = Math.min(threshold, trigger.max);

  return Math.max(1, threshold);
}

/**
 * Whether a history of `tokens` input tokens has reached `trigger`.
 *
 * An absolute trigger fires at `tokens >= trigger`. A window-relative one
 * fires at `tokens >= threshold` (see {@link resolveTokenTrigger}) and also
 * when the reply would not fit: `tokens + maxOutputTokens > window - reserve`
 * (`reserve` defaults to 0, `maxOutputTokens` to 0 when the call sets no cap).
 * Returns `undefined` when a window-relative trigger has no known window.
 */
export function isTokenTriggerReached(
  trigger: TokenTrigger,
  tokens: number,
  contextWindow: number | undefined,
  maxOutputTokens?: number,
): boolean | undefined {
  const threshold = resolveTokenTrigger(trigger, contextWindow);

  if (threshold === undefined) return undefined;
  if (tokens >= threshold) return true;
  if (typeof trigger === "number" || contextWindow === undefined) return false;

  return tokens + (maxOutputTokens ?? 0) > contextWindow - (trigger.reserve ?? 0);
}

/** A trigger in a stable key order, for run signatures. */
export function normalizeTokenTrigger(trigger: TokenTrigger): TokenTrigger {
  if (typeof trigger === "number") return trigger;

  return {
    share: trigger.share,
    ...(trigger.reserve !== undefined ? { reserve: trigger.reserve } : {}),
    ...(trigger.max !== undefined ? { max: trigger.max } : {}),
  };
}
