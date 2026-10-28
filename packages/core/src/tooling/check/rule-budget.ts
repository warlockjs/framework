/** Default time one convention rule may use over a whole run, in milliseconds. */
export const DEFAULT_RULE_BUDGET_MS = 30_000;

/** Per-rule running totals of one convention run. */
export type RuleBudget = {
  /** Milliseconds a rule may use in total; `0` or less turns the budget off. */
  readonly budgetMs: number;
  /** Total milliseconds each rule used so far. */
  readonly elapsed: Map<string, number>;
  /** Rules that went over budget and are skipped from then on, with the files they skipped. */
  readonly exhausted: Map<string, { skippedFiles: number }>;
  /** Called once when a rule goes over budget. */
  readonly onExceeded?: (rule: string, elapsedMs: number) => void;
};

export function createRuleBudget(
  budgetMs: number = DEFAULT_RULE_BUDGET_MS,
  onExceeded?: RuleBudget["onExceeded"],
): RuleBudget {
  return { budgetMs, elapsed: new Map(), exhausted: new Map(), onExceeded };
}

/**
 * Run one rule for one file and add its time to the rule's total. A rule over
 * budget returns `fallback` without running, so one slow rule cannot take the
 * whole command with it. A rule cannot be interrupted in the middle of a
 * single file: the budget is checked between files.
 */
export function withinBudget<T>(
  budget: RuleBudget | undefined,
  rule: string,
  fallback: T,
  run: () => T,
): T {
  if (!budget || budget.budgetMs <= 0) return run();

  const skipped = budget.exhausted.get(rule);

  if (skipped) {
    skipped.skippedFiles++;

    return fallback;
  }

  const startedAt = performance.now();

  try {
    return run();
  } finally {
    const total = (budget.elapsed.get(rule) ?? 0) + (performance.now() - startedAt);

    budget.elapsed.set(rule, total);

    if (total > budget.budgetMs) {
      budget.exhausted.set(rule, { skippedFiles: 0 });
      budget.onExceeded?.(rule, total);
    }
  }
}
