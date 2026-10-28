import {
  InvalidRequestError,
  type ModelCallOptions,
  type ProviderToolDefinition,
} from "@warlock.js/ai";

/**
 * A running allowance of Google Search queries, shared by the model calls of
 * one run. Create it with {@link googleSearchBudget} and pass it as
 * `providerOptions.google.search.budget` on every call of that run.
 */
export type GoogleSearchBudget = {
  /** The allowance the budget was created with. */
  readonly max: number;
  /** Unique search queries the provider reported so far. */
  readonly used: number;
  /** `max - used`, never below zero. */
  readonly remaining: number;
  /** Add queries the provider reported for one finished call. */
  record(queries: number): void;
};

/**
 * Bound Google Search grounding across the model calls of one run.
 *
 * The Gemini API has no per-request search limit: `{ googleSearch: {} }` takes
 * no `max_uses`, and the model decides how many queries one `generateContent`
 * call runs. What the adapter can enforce is the number of queries across
 * calls: after each call it adds the queries Google reported
 * (`groundingMetadata.webSearchQueries`, counted the way Gemini 3 bills them,
 * unique and non-empty) to the budget, and once the budget is spent it stops
 * sending the `googleSearch` tool, so later calls run without search. One
 * call that is already running can still overshoot the budget by the queries
 * it makes itself.
 *
 * @example
 * const budget = googleSearchBudget(3);
 * const search = ai.providerTool({ provider: "google", definition: { googleSearch: {} } });
 * await model.complete(messages, {
 *   tools: [search],
 *   providerOptions: { google: { search: { budget } } },
 * });
 * budget.used; // queries spent so far
 */
export function googleSearchBudget(maxQueries: number): GoogleSearchBudget {
  if (!Number.isInteger(maxQueries) || maxQueries < 0) {
    throw new InvalidRequestError(
      `googleSearchBudget(maxQueries) needs a non-negative integer, got ${String(maxQueries)}.`,
    );
  }

  let used = 0;

  return {
    max: maxQueries,
    get used() {
      return used;
    },
    get remaining() {
      return Math.max(0, maxQueries - used);
    },
    record(queries) {
      if (Number.isFinite(queries) && queries > 0) {
        used += queries;
      }
    },
  };
}

/** The budget on a call, validated; `undefined` when the call sets none. */
export function searchBudgetOf(
  options: ModelCallOptions | undefined,
): GoogleSearchBudget | undefined {
  const search = (options?.providerOptions?.google as { search?: { budget?: unknown } } | undefined)
    ?.search;
  const budget = search?.budget;

  if (budget === undefined) {
    return undefined;
  }

  if (
    typeof budget !== "object" ||
    budget === null ||
    typeof (budget as GoogleSearchBudget).record !== "function" ||
    typeof (budget as GoogleSearchBudget).remaining !== "number"
  ) {
    throw new InvalidRequestError(
      "providerOptions.google.search.budget must come from googleSearchBudget(maxQueries).",
    );
  }

  return budget as GoogleSearchBudget;
}

/** `true` for a Gemini tool entry that runs Google Search grounding. */
export function isSearchDefinition(definition: ProviderToolDefinition["definition"]): boolean {
  return "googleSearch" in definition || "googleSearchRetrieval" in definition;
}
