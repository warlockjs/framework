import { matchesIntent, requiredToolsCalled, type IntentMatcher } from "../agent/tool-use-contract";
import type { EvalScore, EvalScorer, EvalScorerContext } from "../contracts/agent/eval.type";

/** Options of {@link requiredToolCalled}. */
export type RequiredToolCalledOptions = {
  /** Tools that count as acting. */
  tools: ReadonlyArray<string>;
  /**
   * Cases whose input matches count as action requests; other cases pass
   * without checking. Default: every case is an action request.
   */
  intents?: ReadonlyArray<IntentMatcher>;
  /** `"any"` (default): one of `tools` is enough. `"all"`: each must have been called. */
  require?: "any" | "all";
};

/**
 * Scorer: the agent called a required tool. Fails when the case asked for an
 * action (its input matches `intents`, or always when `intents` is omitted)
 * and no required tool call succeeded. Use it to catch an agent that offers
 * a change instead of making it.
 *
 * @example
 * await agent.eval({
 *   cases: [{ name: "swap", input: "Swap squats for lunges" }],
 *   scorers: [ai.eval.requiredToolCalled({ tools: ["update_plan"] })],
 * });
 */
export function requiredToolCalled<TOutput = unknown>(
  options: RequiredToolCalledOptions,
): EvalScorer<TOutput> {
  return (context: EvalScorerContext<TOutput>): EvalScore => {
    const { intents } = options;

    if (intents && !matchesIntent(context.case.input, intents)) {
      return { score: 1, passed: true, reason: "not an action request; no tool required" };
    }

    const called = requiredToolsCalled(
      context.result.report.children,
      options.tools,
      options.require,
    );

    return called
      ? { score: 1, passed: true, reason: "a required tool was called" }
      : {
          score: 0,
          passed: false,
          reason: `required tool not called (${options.tools.join(", ")})`,
        };
  };
}

/** Options of {@link changeClaimedWithoutToolCall}. */
export type ChangeClaimedWithoutToolCallOptions = {
  /**
   * Tools that make a change. A claim is backed when one of them completed.
   * Default: any tool call that completed backs the claim.
   */
  tools?: ReadonlyArray<string>;
  /**
   * What a claim of having changed something looks like in the reply.
   * Default: first-person past tense of common edit verbs ("I've updated",
   * "I swapped", "I have added", "done: removed").
   */
  claims?: ReadonlyArray<RegExp>;
};

const DEFAULT_CLAIMS: ReadonlyArray<RegExp> = [
  /\bI(?:'ve|\s+have)?\s+(?:just\s+)?(?:updated|changed|swapped|replaced|added|removed|deleted|saved|moved|scheduled|rescheduled|created|set|adjusted|edited|booked|cancelled|canceled)\b/i,
  /\b(?:has|have)\s+been\s+(?:updated|changed|swapped|replaced|added|removed|deleted|saved|moved|scheduled|created|set|adjusted)\b/i,
  /\b(?:all\s+)?done[:!.]\s*(?:I\s+)?(?:updated|changed|swapped|replaced|added|removed|deleted|saved)\b/i,
];

/**
 * Scorer: the reply does not claim a change that no tool made. Fails when
 * the reply says something was changed ("I've swapped it") and no change
 * tool call completed. Passes when there is no such claim, or the claim is
 * backed by a completed call.
 *
 * @example
 * scorers: [ai.eval.changeClaimedWithoutToolCall({ tools: ["update_plan"] })]
 */
export function changeClaimedWithoutToolCall<TOutput = unknown>(
  options: ChangeClaimedWithoutToolCallOptions = {},
): EvalScorer<TOutput> {
  const claims = options.claims ?? DEFAULT_CLAIMS;

  return (context: EvalScorerContext<TOutput>): EvalScore => {
    const reply = context.text ?? (typeof context.output === "string" ? context.output : "");
    const claimed = claims.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(reply);
    });

    if (!claimed) {
      return { score: 1, passed: true, reason: "no change claimed" };
    }

    const completed = context.result.report.children.filter((call) => call.status === "completed");
    const backed = options.tools
      ? completed.some((call) => options.tools?.includes(call.name))
      : completed.length > 0;

    return backed
      ? { score: 1, passed: true, reason: "the claimed change was made by a tool call" }
      : { score: 0, passed: false, reason: "change claimed without a tool call" };
  };
}
