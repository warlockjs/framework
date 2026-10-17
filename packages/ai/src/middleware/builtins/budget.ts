import type {
  AgentMiddleware,
  MiddlewareExecuteContext,
  MiddlewareTripContext,
} from "../../contracts/middleware";
import type { ModelPricing } from "../../contracts/result/model-pricing.type";
import type { Usage } from "../../contracts/result/usage.type";
import { BudgetExceededError, ScopedBudgetExceededError, type BudgetUnit } from "../../errors";
import { computeCost, totalCost } from "../../utils/compute-cost";
import { estimateInputTokens } from "../../utils/estimate-input-tokens";
import { namespacedState } from "../utils";
import type {
  BudgetContract,
  BudgetContractDimension,
  BudgetContractViolation,
} from "./budget-contract.type";
import type {
  ScopedBudgetReserveInput,
  ScopedBudgetStore,
  ScopedBudgetWindow,
} from "./scoped-budget-store.type";

export { cacheScopedBudgetStore } from "./cache-scoped-budget-store";
export type { CacheScopedBudgetStoreOptions } from "./cache-scoped-budget-store";
export {
  cascadeScopedBudgetStore,
  CascadeScopedBudgetStoreUnavailableError,
} from "./cascade-scoped-budget-store";
export type {
  CascadeScopedBudgetModel,
  CascadeScopedBudgetStoreOptions,
} from "./cascade-scoped-budget-store";
export { memoryScopedBudgetStore } from "./memory-scoped-budget-store";
export type {
  ScopedBudgetReserveInput,
  ScopedBudgetReserveResult,
  ScopedBudgetStore,
  ScopedBudgetWindow,
} from "./scoped-budget-store.type";

export type {
  BudgetContract,
  BudgetContractDimension,
  BudgetContractFallback,
  BudgetContractViolation,
  BudgetContractViolationMode,
} from "./budget-contract.type";

/**
 * Per-model pricing used to compute USD cost from token counts.
 * Caller-supplied; keys are model names (the `ModelContract.name`
 * value). Each entry is either:
 *
 * - a {@link ModelPricing} (USD per **1M** tokens, with the optional
 *   cache-read / cache-write rates) — billed exactly like `Usage.cost`,
 *   cache channels included; or
 * - the legacy `{ inputPer1K, outputPer1K }` (USD per **1K** tokens),
 *   which prices input and output only and ignores cache rates.
 *
 * @example
 * budget({
 *   maxCostUSD: 1,
 *   pricing: { "claude-sonnet-4-6": { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 } },
 * });
 */
export type BudgetPricing = Record<string, BudgetPricingEntry>;

/** One {@link BudgetPricing} entry: a `ModelPricing` or the legacy per-1K shape. */
export type BudgetPricingEntry =
  | ModelPricing
  | {
      /** USD per 1,000 input tokens. */
      inputPer1K: number;
      /** USD per 1,000 output tokens. */
      outputPer1K: number;
    };

/**
 * Reserve-then-commit mode for `budget()`: before each model call the
 * middleware **reserves** the trip's worst case — the input-token count
 * plus `outputTokens`, priced as uncached input — and refuses the call if
 * that would cross a cap. After the call it **commits** the actual usage
 * in place of the reservation; when the call fails it **releases** the
 * reservation. A single trip therefore can no longer overrun a cap.
 *
 * Applies to the top-level `maxTokens` / `maxCostUSD` caps and to the
 * contract's caps under `onViolation: "abort"` (both per run), and to the
 * `scoped` ledger, where the reservation is taken atomically by the store
 * so concurrent runs sharing a key cannot jointly overspend.
 */
export type BudgetReserveOptions = {
  /**
   * Output tokens to reserve per trip — set it to the `maxTokens` the
   * model is called with, since that is the most a trip can generate.
   */
  outputTokens: number;
  /**
   * Input tokens to reserve for a trip. Default: `estimateInputTokens`
   * over the trip's messages (an offline estimate that does not see the
   * tool schemas). Supply a native count (`model.countTokens`) or add
   * headroom here when the estimate is too loose for your caps.
   */
  inputTokens?: (context: MiddlewareTripContext) => number | Promise<number>;
};

/** Behavior when a USD-capped run has no price for its configured model. */
export type BudgetUnpricedBehavior = "error" | "allow";

/** A cross-execution token and/or cost limit for one UTC window. */
export type ScopedBudgetOptions = {
  /** Application-owned identity, commonly a user or tenant id. */
  key: string | ((context: MiddlewareExecuteContext) => string);
  /** UTC ledger boundary. */
  window: ScopedBudgetWindow;
  /** Maximum aggregate tokens for this key and window. */
  maxTokens?: number;
  /** Maximum aggregate USD cost for this key and window. Requires pricing. */
  maxCostUSD?: number;
  /** Atomic ledger implementation shared by all executions in the scope. */
  store: ScopedBudgetStore;
};

/**
 * Configuration for `budget()`. At least one of `maxTokens` or
 * `maxCostUSD` must be supplied — a budget with no cap is a no-op.
 */
export type BudgetOptions = {
  /**
   * Hard cap on cumulative total tokens (input + output, summed
   * across every trip of the run). Inclusive — exceeding triggers
   * the configured `onExceeded`.
   */
  maxTokens?: number;
  /**
   * Hard cap on cumulative USD cost. Requires `pricing` for the
   * agent's configured model. Without a pricing entry the run fails
   * closed: `onUnpriced` (default `"error"`) refuses it unless set to
   * `"allow"`, which skips the USD check (token caps still apply).
   */
  maxCostUSD?: number;
  /**
   * Per-model pricing table used to compute USD cost. Only consulted
   * when `maxCostUSD` is set. Model names must match the running
   * agent's `ModelContract.name` exactly.
   */
  pricing?: BudgetPricing;
  /**
   * Behavior when a USD cap is configured but no pricing can be resolved
   * for the running model. Defaults to `"error"` so dollar caps cannot
   * silently fail open. Set `"allow"` only when that risk is intentional.
   */
  onUnpriced?: BudgetUnpricedBehavior;
  /**
   * Behavior when a cap is breached. `"abort"` throws
   * `BudgetExceededError` — surfaces on `result.error`, stops the
   * run at the next trip boundary. `"warn"` logs a warning and
   * lets the run continue (useful for observability-first rollouts
   * before flipping the switch to abort). Default `"abort"`.
   */
  onExceeded?: "abort" | "warn";
  /**
   * Override the middleware name. Useful when two budgets coexist
   * (e.g. a per-request cap plus a session-wide cap via different
   * instances). Default `"budget"`.
   */
  name?: string;
  /**
   * Declarative SLO / cost contract enforced on top of (and
   * independently of) the legacy `maxTokens` / `maxCostUSD` caps.
   * Adds a wall-clock `maxLatencyMs` dimension and a per-contract
   * `onViolation` reaction (`"abort"` hard-stops, `"fallback"` records
   * a signal + fires `fallback` and lets the run continue). Omit to
   * keep the classic budget behavior unchanged.
   *
   * Read a recorded fallback signal back with
   * {@link readBudgetFallbackSignal}.
   */
  contract?: BudgetContract;
  /**
   * Cross-execution UTC ledger. Without `reserve`, measured per-trip usage
   * is atomically booked after each response. With `reserve`, the trip's
   * worst case is reserved atomically before the call and settled to the
   * actual usage after it. Supply one or both scoped caps.
   */
  scoped?: ScopedBudgetOptions;
  /**
   * Reserve each trip's worst-case spend before the call instead of only
   * booking usage after it — see {@link BudgetReserveOptions}.
   *
   * @example
   * budget({ maxCostUSD: 0.5, reserve: { outputTokens: 4_096 } });
   */
  reserve?: BudgetReserveOptions;
};

/** One unit of an in-flight reservation (run-level amounts and the scoped ledger inputs). */
type PendingReservation = {
  tokens: number;
  costUSD: number;
  scoped: ScopedBudgetReserveInput[];
};

type BudgetCounters = {
  tokens: number;
  costUSD: number;
  warned: boolean;
  /**
   * Wall-clock epoch ms captured at `execute.before`. Used to derive
   * cumulative run latency for the contract's `maxLatencyMs` clause.
   */
  startedAt: number;
  /**
   * Set once a `"fallback"` contract clause has fired, so the signal +
   * callback are emitted at most once per run even if later trips keep
   * breaching.
   */
  fallbackFired: boolean;
  scopedKey?: string;
  scopedWindowStart?: number;
  /** The reservation of the trip in flight (`reserve` mode only). */
  pending?: PendingReservation;
};

/**
 * Recorded contract fallback signal, stashed under the `<name>.fallback`
 * state key when a `"fallback"` clause trips. A fallback orchestrator
 * reads it via {@link readBudgetFallbackSignal} to decide how to degrade.
 */
export type BudgetFallbackSignal = BudgetContractViolation;

/**
 * The `BudgetUnit` to stamp on the thrown error per contract dimension.
 * Latency has no native unit — it borrows `"requests"` as the least-wrong
 * operational measure, while the authoritative detail rides on the
 * error's `context.dimension`.
 */
const DIMENSION_UNIT: Record<BudgetContractDimension, BudgetUnit> = {
  tokens: "tokens",
  cost: "usd",
  latency: "requests",
};

function breach(limit: number, actual: number, unit: BudgetUnit, name: string): never {
  throw new BudgetExceededError(`budget "${name}" exceeded — ${actual} ${unit} (cap: ${limit})`, {
    limit,
    actual,
    unit,
  });
}

function unpricedModelBreach(name: string, modelName: string): never {
  throw new BudgetExceededError(
    `budget "${name}" cannot enforce a USD cap for unpriced model "${modelName}"; ` +
      `configure pricing or set onUnpriced: "allow" to opt out`,
    { limit: 0, actual: 0, unit: "usd", context: { model: modelName, reason: "unpriced" } },
  );
}

function resolveTripCost(
  context: MiddlewareExecuteContext,
  usage: Pick<
    Usage,
    | "input"
    | "output"
    | "cachedTokens"
    | "cacheWriteTokens"
    | "cacheWrite1hTokens"
    | "reasoningTokens"
    | "inputIncludesCache"
  >,
  budgetPricing: BudgetPricing | undefined,
): number | undefined {
  const explicitPricing = budgetPricing?.[context.model.name];

  if (explicitPricing && "inputPer1K" in explicitPricing) {
    return (
      (usage.input / 1000) * explicitPricing.inputPer1K +
      (usage.output / 1000) * explicitPricing.outputPer1K
    );
  }

  const modelPricing: ModelPricing | undefined = explicitPricing ?? context.model.pricing;

  return totalCost(computeCost({ ...usage, total: usage.input + usage.output }, modelPricing));
}

/** True when `budget()` can price the running model (explicit entry or model pricing). */
function hasPricing(context: MiddlewareExecuteContext, budgetPricing: BudgetPricing | undefined) {
  return budgetPricing?.[context.model.name] !== undefined || context.model.pricing !== undefined;
}

/**
 * Book a scoped reservation; returns the reservation input to settle
 * later, or `undefined` when the unit has no cap or nothing to reserve.
 */
async function reserveScopedUnit(
  options: ScopedBudgetOptions,
  key: string,
  windowStart: number,
  unit: BudgetUnit,
  amount: number,
): Promise<ScopedBudgetReserveInput | undefined> {
  const limit = unit === "tokens" ? options.maxTokens : options.maxCostUSD;

  if (limit === undefined || amount <= 0) {
    return undefined;
  }

  const input: ScopedBudgetReserveInput = { key, windowStart, unit, amount, limit };
  const reservation = await options.store.reserve(input);

  if (!reservation.allowed) {
    throw new ScopedBudgetExceededError(
      `scoped budget "${key}" would be exceeded for ${options.window} — reserving ${amount} ${unit} brings it to ${reservation.used} (cap: ${limit})`,
      { key, window: options.window, limit, used: reservation.used, unit },
    );
  }

  return input;
}

/**
 * Settle a scoped reservation to the actual amount. The money is already
 * spent, so the actual is always booked (the store's limit check is
 * lifted); the cap is then compared and breached after the fact.
 */
async function commitScopedUnit(
  options: ScopedBudgetOptions,
  reservation: ScopedBudgetReserveInput,
  actual: number,
): Promise<void> {
  const result = await options.store.commit(
    { ...reservation, limit: Number.MAX_SAFE_INTEGER },
    actual,
  );

  if (result.used > reservation.limit) {
    throw new ScopedBudgetExceededError(
      `scoped budget "${reservation.key}" exceeded for ${options.window} — ${result.used} ${reservation.unit} (cap: ${reservation.limit})`,
      {
        key: reservation.key,
        window: options.window,
        limit: reservation.limit,
        used: result.used,
        unit: reservation.unit,
      },
    );
  }
}

/** Release an unsettled reservation (failed call, aborted run). */
async function releasePending(
  options: BudgetOptions,
  counters: BudgetCounters | undefined,
): Promise<void> {
  const pending = counters?.pending;

  if (!counters || !pending) {
    return;
  }

  counters.pending = undefined;

  if (!options.scoped) {
    return;
  }

  for (const reservation of pending.scoped) {
    await options.scoped.store.refund(reservation);
  }
}

function reservationBreach(
  name: string,
  limit: number,
  spent: number,
  reserved: number,
  unit: BudgetUnit,
): never {
  throw new BudgetExceededError(
    `budget "${name}" would be exceeded — ${spent} ${unit} spent + ${reserved} reserved for the next call (cap: ${limit})`,
    {
      limit,
      actual: spent + reserved,
      unit,
      context: { reason: "reservation", spent, reserved },
    },
  );
}

function breachContract(
  name: string,
  dimension: BudgetContractDimension,
  limit: number,
  actual: number,
): never {
  throw new BudgetExceededError(
    `budget "${name}" contract exceeded — ${dimension} ${actual} (cap: ${limit})`,
    {
      limit,
      actual,
      unit: DIMENSION_UNIT[dimension],
      context: { dimension, limit, actual, source: "contract" },
    },
  );
}

function scopedWindowStart(window: ScopedBudgetWindow, now = new Date()): number {
  if (window === "day") {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

async function reserveScopedBudget(
  options: ScopedBudgetOptions,
  key: string,
  windowStart: number,
  unit: BudgetUnit,
  amount: number,
): Promise<void> {
  const limit = unit === "tokens" ? options.maxTokens : options.maxCostUSD;

  if (limit === undefined || amount === 0) {
    return;
  }

  const reservation = await options.store.reserve({
    key,
    windowStart,
    unit,
    amount,
    limit,
  });

  if (!reservation.allowed) {
    throw new ScopedBudgetExceededError(
      `scoped budget "${key}" exceeded for ${options.window} — ${reservation.used} ${unit} (cap: ${limit})`,
      { key, window: options.window, limit, used: reservation.used, unit },
    );
  }
}

/**
 * Read the contract fallback signal recorded by a `budget()` middleware
 * running under `contract.onViolation: "fallback"`. Returns `undefined`
 * when no clause was breached.
 *
 * **Role.** The middleware cannot itself switch models on a soft breach,
 * so it records a typed {@link BudgetFallbackSignal} in the shared state
 * bag and lets the run continue. A fallback orchestrator (or the
 * `execute.after` hook of an outer middleware) reads it back here and
 * decides how to degrade the next run — cheaper model, cached answer,
 * truncated context.
 *
 * @param state - The middleware state bag (`ctx.state`).
 * @param name - The budget middleware's name. Default `"budget"`,
 *   matching `BudgetOptions.name`'s default.
 *
 * @example
 * const guard = budget({ contract: { maxCostUSD: 0.05, onViolation: "fallback" } });
 *
 * // In an outer middleware's execute.after, after the run:
 * const signal = readBudgetFallbackSignal(ctx.state);
 * if (signal?.dimension === "cost") {
 *   await rerunOnCheaperModel();
 * }
 */
export function readBudgetFallbackSignal(
  state: MiddlewareExecuteContext["state"],
  name = "budget",
): BudgetFallbackSignal | undefined {
  return namespacedState<BudgetFallbackSignal>({ state }, `${name}.fallback`).get();
}

/**
 * Enforced token and / or USD budget for an agent run.
 *
 * **Role.** Guards against runaway tool loops, misconfigured
 * prompts, and unexpected provider price swings by capping
 * cumulative usage across every LLM trip of a single execution.
 * Aborts the run with a typed `BudgetExceededError` the moment a cap
 * is breached, rather than letting the damage grow trip by trip.
 *
 * **Scope.** Per-execution. A fresh counter is created at
 * `execute.before` and lives in the middleware state bag until the
 * run ends. Two concurrent `agent.execute()` calls on the same
 * agent therefore enforce the cap independently.
 *
 * **Token accounting.** After each successful trip, the middleware
 * adds `response.usage.total` to its running total and checks
 * against `maxTokens`. Synthetic trips (cache hits) contribute
 * `usage.total` as returned by the cache — cache middleware is
 * expected to surface zero usage on a hit, which naturally excludes
 * those trips from the budget.
 *
 * **USD accounting.** When `maxCostUSD` + `pricing[modelName]` are
 * both present, the middleware converts per-trip input / output
 * tokens to USD and accumulates. Missing pricing fails closed:
 * `onUnpriced` defaults to `"error"` and refuses the run; only
 * `onUnpriced: "allow"` skips the USD check (tokens-only).
 *
 * **Warn mode.** `onExceeded: "warn"` logs a single warning the first
 * time a cap is breached and lets the run continue. Useful for
 * measuring real-world traffic against a proposed cap before flipping
 * to `"abort"` in production.
 *
 * **Contract / SLO mode.** Pass `contract` to enforce a declarative
 * service-level objective — `maxCostUSD`, `maxLatencyMs`, `maxTokens` —
 * on top of the legacy caps, with a single `onViolation` reaction:
 * `"abort"` hard-stops with `BudgetExceededError`; `"fallback"` records
 * a typed signal (read it via {@link readBudgetFallbackSignal}), fires
 * the optional `fallback` callback, and lets the run continue so an
 * outer layer can degrade gracefully. The contract's clauses are
 * evaluated independently of — and after — the top-level caps; the
 * top-level caps stay fully functional with or without a contract.
 *
 * @example
 * const budgetMiddleware = budget({ maxTokens: 50_000 });
 *
 * const myAgent = agent({
 *   model,
 *   middleware: [budgetMiddleware],
 * });
 *
 * @example
 * // With USD cap and custom pricing
 * const guard = budget({
 *   maxCostUSD: 0.5,
 *   pricing: {
 *     "gpt-4o": { inputPer1K: 0.005, outputPer1K: 0.015 },
 *   },
 * });
 *
 * @example
 * // SLO contract — soft-fallback on any breach
 * const sloGuard = budget({
 *   pricing: { "gpt-4o": { inputPer1K: 0.005, outputPer1K: 0.015 } },
 *   contract: {
 *     maxCostUSD: 0.05,
 *     maxLatencyMs: 8_000,
 *     maxTokens: 40_000,
 *     onViolation: "fallback",
 *     fallback: (violation) => routeToCheaperModel(violation.dimension),
 *   },
 * });
 */
export function budget(options: BudgetOptions): AgentMiddleware {
  const name = options.name ?? "budget";
  const onExceeded = options.onExceeded ?? "abort";
  const hasTokenCap = typeof options.maxTokens === "number";
  const hasCostCap = typeof options.maxCostUSD === "number";

  const contract = options.contract;
  const contractMode = contract?.onViolation ?? "abort";
  const hasContractTokenCap = typeof contract?.maxTokens === "number";
  const hasContractCostCap = typeof contract?.maxCostUSD === "number";
  const hasContractLatencyCap = typeof contract?.maxLatencyMs === "number";
  const hasScopedCostCap = typeof options.scoped?.maxCostUSD === "number";
  const needsCost = hasCostCap || hasContractCostCap || hasScopedCostCap;

  return {
    name,
    execute: {
      before(context) {
        if (needsCost && options.onUnpriced !== "allow" && !hasPricing(context, options.pricing)) {
          unpricedModelBreach(name, context.model.name);
        }

        const counters = namespacedState<BudgetCounters>(context, name);
        counters.set({
          tokens: 0,
          costUSD: 0,
          warned: false,
          startedAt: Date.now(),
          fallbackFired: false,
          scopedKey:
            typeof options.scoped?.key === "function"
              ? options.scoped.key(context)
              : options.scoped?.key,
          scopedWindowStart: options.scoped ? scopedWindowStart(options.scoped.window) : undefined,
        });
      },
      async after(context) {
        await releasePending(options, namespacedState<BudgetCounters>(context, name).get());
      },
      async onError(context) {
        await releasePending(options, namespacedState<BudgetCounters>(context, name).get());
      },
    },
    trip: {
      async before(context) {
        const reserve = options.reserve;
        const counters = namespacedState<BudgetCounters>(context, name).get();

        if (!reserve || !counters) {
          return;
        }

        // A reservation left by a trip whose `after` never ran (an inner
        // middleware threw past us) is released before taking a new one.
        await releasePending(options, counters);

        const inputTokens = Math.max(
          0,
          (await reserve.inputTokens?.(context)) ?? estimateInputTokens(context.messages),
        );
        const outputTokens = Math.max(0, reserve.outputTokens);
        const tokens = inputTokens + outputTokens;
        const costUSD = needsCost
          ? (resolveTripCost(
              context,
              { input: inputTokens, output: outputTokens },
              options.pricing,
            ) ?? 0)
          : 0;

        const tokenCaps = [
          onExceeded === "abort" ? options.maxTokens : undefined,
          contractMode === "abort" ? contract?.maxTokens : undefined,
        ];
        const costCaps = [
          onExceeded === "abort" ? options.maxCostUSD : undefined,
          contractMode === "abort" ? contract?.maxCostUSD : undefined,
        ];

        for (const cap of tokenCaps) {
          if (cap !== undefined && counters.tokens + tokens > cap) {
            reservationBreach(name, cap, counters.tokens, tokens, "tokens");
          }
        }

        for (const cap of costCaps) {
          if (cap !== undefined && counters.costUSD + costUSD > cap) {
            reservationBreach(name, cap, counters.costUSD, costUSD, "usd");
          }
        }

        const pending: PendingReservation = { tokens, costUSD, scoped: [] };
        counters.pending = pending;

        if (options.scoped && counters.scopedKey && counters.scopedWindowStart !== undefined) {
          for (const [unit, amount] of [
            ["tokens", tokens],
            ["usd", costUSD],
          ] as const) {
            const reservation = await reserveScopedUnit(
              options.scoped,
              counters.scopedKey,
              counters.scopedWindowStart,
              unit,
              amount,
            );

            if (reservation) {
              pending.scoped.push(reservation);
            }
          }
        }
      },
      async onError(context) {
        await releasePending(options, namespacedState<BudgetCounters>(context, name).get());
      },
      async after(context, response) {
        const counters = namespacedState<BudgetCounters>(context, name).get();

        if (!counters) {
          return;
        }

        counters.tokens += response.usage.total;

        const tripCost = resolveTripCost(context, response.usage, options.pricing);

        if (needsCost && tripCost !== undefined) {
          counters.costUSD += tripCost;
        }

        const pending = counters.pending;
        counters.pending = undefined;

        if (options.scoped && counters.scopedKey && counters.scopedWindowStart !== undefined) {
          const actualFor = (unit: BudgetUnit): number =>
            unit === "tokens" ? response.usage.total : (tripCost ?? 0);
          const settled = new Set<BudgetUnit>();

          // Reserve mode: settle each reservation to the actual usage.
          for (const reservation of pending?.scoped ?? []) {
            await commitScopedUnit(options.scoped, reservation, actualFor(reservation.unit));
            settled.add(reservation.unit);
          }

          // Book what was not reserved (classic mode, or a unit whose
          // reservation was zero).
          for (const unit of ["tokens", "usd"] as const) {
            if (!settled.has(unit)) {
              await reserveScopedBudget(
                options.scoped,
                counters.scopedKey,
                counters.scopedWindowStart,
                unit,
                actualFor(unit),
              );
            }
          }
        }

        if (hasTokenCap && counters.tokens > options.maxTokens!) {
          if (onExceeded === "abort") {
            breach(options.maxTokens!, counters.tokens, "tokens", name);
          }

          if (!counters.warned) {
            counters.warned = true;
          }
        }

        if (hasCostCap && counters.costUSD > options.maxCostUSD!) {
          if (onExceeded === "abort") {
            breach(options.maxCostUSD!, counters.costUSD, "usd", name);
          }

          if (!counters.warned) {
            counters.warned = true;
          }
        }

        if (!contract) {
          return;
        }

        if (hasContractTokenCap && counters.tokens > contract.maxTokens!) {
          await enforceContract(
            context,
            counters,
            name,
            contractMode,
            contract,
            "tokens",
            contract.maxTokens!,
            counters.tokens,
          );
        }

        if (hasContractCostCap && counters.costUSD > contract.maxCostUSD!) {
          await enforceContract(
            context,
            counters,
            name,
            contractMode,
            contract,
            "cost",
            contract.maxCostUSD!,
            counters.costUSD,
          );
        }

        if (hasContractLatencyCap) {
          const elapsedMs = Date.now() - counters.startedAt;

          if (elapsedMs > contract.maxLatencyMs!) {
            await enforceContract(
              context,
              counters,
              name,
              contractMode,
              contract,
              "latency",
              contract.maxLatencyMs!,
              elapsedMs,
            );
          }
        }
      },
    },
  };
}

/**
 * Apply the contract's reaction to a single breached clause. `"abort"`
 * throws `BudgetExceededError` (stops the run); `"fallback"` records the
 * signal once, fires the callback, and returns so the run continues.
 *
 * The callback is invoked at most once per run (guarded by
 * `counters.fallbackFired`) and its rejections are swallowed — a buggy
 * fallback hook must never crash the agent.
 */
async function enforceContract(
  context: MiddlewareExecuteContext,
  counters: BudgetCounters,
  name: string,
  mode: NonNullable<BudgetContract["onViolation"]>,
  contract: BudgetContract,
  dimension: BudgetContractDimension,
  limit: number,
  actual: number,
): Promise<void> {
  if (mode === "abort") {
    breachContract(name, dimension, limit, actual);
  }

  if (counters.fallbackFired) {
    return;
  }

  counters.fallbackFired = true;

  const violation: BudgetContractViolation = {
    dimension,
    limit,
    actual,
    mode,
  };

  namespacedState<BudgetContractViolation>(context, `${name}.fallback`).set(violation);

  if (!contract.fallback) {
    return;
  }

  try {
    await contract.fallback(violation, context);
  } catch {
    // A fallback callback is a notification hook — its failure must
    // never crash the run. Swallow deliberately.
  }
}
