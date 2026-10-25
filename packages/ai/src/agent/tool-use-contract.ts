import type { Message } from "../contracts/conversation-message.type";
import type { ToolCall } from "../contracts/result/tool-call.type";
import { SchemaValidationError } from "../errors";

/**
 * Something that recognises a kind of user request: a case-insensitive
 * substring, a regular expression, or a predicate over the turn's input.
 */
export type IntentMatcher = string | RegExp | ((input: string) => boolean);

/** What a hint builder sees when an `actWhenAsked` re-prompt is about to be sent. */
export type ActWhenAskedHintContext = {
  /** The user input of this run. */
  input: string;
  /** The model's answer that did not call a required tool. */
  reply: string;
  /** The tools that were required. */
  requiredTools: ReadonlyArray<string>;
  tripIndex: number;
};

/**
 * `AgentConfig.actWhenAsked`: when the user's turn matches one of the
 * intents (for example "swap my squat for lunges") and the model answers
 * without calling a required tool, the agent re-prompts once with a hint
 * instead of accepting an offer where an action was asked for.
 *
 * Off unless configured; an agent without it behaves exactly as before.
 *
 * @example
 * ai.agent({
 *   model,
 *   tools: [updatePlan],
 *   actWhenAsked: {
 *     intents: [/\b(swap|replace|change|add|remove)\b/i],
 *     requiredTools: ["update_plan"],
 *   },
 * });
 */
export type ActWhenAskedConfig = {
  /** Any match makes the turn an action request. */
  intents: ReadonlyArray<IntentMatcher>;
  /** Tools that count as acting. */
  requiredTools: ReadonlyArray<string>;
  /** `"any"` (default): one of `requiredTools` is enough. `"all"`: each must have been called. */
  require?: "any" | "all";
  /** Text of the re-prompt, or a builder. Default: ask the model to call the tool now. */
  hint?: string | ((context: ActWhenAskedHintContext) => string);
  /** Re-prompts per run. Default `1`. */
  maxReprompts?: number;
};

/** What a refusal hint builder sees. */
export type ToolRefusalHintContext = {
  /** Name of the tool that refused. */
  tool: string;
  /** Why it refused, from the tool's error or result. */
  reason: string;
  /** The arguments the model sent. */
  input: unknown;
  tripIndex: number;
};

/**
 * `AgentConfig.onToolRefusal` as an object. `"retry-once-with-hint"` is the
 * same as `{ retries: 1 }`.
 */
export type ToolRefusalConfig = {
  /** Retries per run after a model answer that gave up on a refused call. Default `1`. */
  retries?: number;
  /** Text of the retry prompt, or a builder. Default: quote the reason and ask for a valid retry. */
  hint?: string | ((context: ToolRefusalHintContext) => string);
  /**
   * Decide whether a finished call was a refusal; return the reason (or
   * `undefined` / `false` for no). Default: a schema validation error, or a
   * result object with `refused: true` or `ok: false` and a `reason`,
   * `error` or `message` string.
   */
  isRefusal?: (call: ToolCall) => string | undefined | false;
};

/** `AgentConfig.onToolRefusal`. */
export type ToolRefusalOption = "off" | "retry-once-with-hint" | ToolRefusalConfig;

/** The moment a backstop runs. */
export type BackstopPhase = "before" | "after";

/**
 * What a backstop detector sees.
 *
 * - `before`: once, before the first model call of the run; `reply` is absent.
 * - `after`: after each model answer that ends the run (no tool calls to
 *   dispatch); `reply` is that answer.
 */
export type BackstopTurn = {
  phase: BackstopPhase;
  runId: string;
  /** The user input of this run. */
  input: string;
  /** The final model answer; only in `"after"`. */
  reply?: string;
  tripIndex: number;
  /** Tool calls dispatched so far in this run. */
  toolCalls: ReadonlyArray<ToolCall>;
  /** The conversation so far. */
  messages: ReadonlyArray<Message>;
};

/** What a backstop `run` receives. */
export type BackstopContext = BackstopTurn & {
  /** The agent's name. */
  agent: string;
  /** Scratch space shared by this run's backstops. */
  state: Record<string, unknown>;
};

/** Optional result of a backstop `run`. */
export type BackstopOutcome = {
  /**
   * Text sent to the model as an extra user message. `"before"`: added ahead
   * of the first call. `"after"`: a re-prompt, at most once per backstop per run.
   */
  prompt?: string;
};

/**
 * A deterministic server-side check around the model turn: `detect` decides
 * (for example "the user said they hurt their knee"), `run` acts (save the
 * injury, add context, ask the model again). A throw in either is logged and
 * skipped; it never fails the run.
 *
 * @example
 * const injuryBackstop: AgentBackstop = {
 *   name: "injury-capture",
 *   detect: (turn) => /\b(hurt|injur|pain)\b/i.test(turn.input),
 *   run: async ({ input }) => { await saveInjury(input); },
 * };
 */
export type AgentBackstop = {
  /** Shown in logs and the agent trace. */
  name?: string;
  /** Default `"after"`. */
  phase?: BackstopPhase;
  detect(turn: BackstopTurn): boolean | Promise<boolean>;
  run(context: BackstopContext): void | BackstopOutcome | Promise<void | BackstopOutcome>;
};

/** One thing the tool-use contract did in a run; recorded in the agent trace. */
export type ToolUseContractEvent =
  | { type: "act-reprompt"; tripIndex: number; requiredTools: string[]; hint: string }
  | { type: "refusal-retry"; tripIndex: number; tool: string; reason: string; hint: string }
  | { type: "backstop"; tripIndex: number; name: string; phase: BackstopPhase; prompted: boolean };

/** The default re-prompt of `actWhenAsked`. */
export function defaultActHint(requiredTools: ReadonlyArray<string>): string {
  const names = requiredTools.map((name) => `"${name}"`).join(" or ");

  return `The user asked for a change. Do it now by calling ${names} instead of offering or describing it, then confirm what changed.`;
}

/** The default retry prompt of `onToolRefusal`. */
export function defaultRefusalHint(tool: string, reason: string): string {
  return `The tool "${tool}" refused your last call: ${reason}. Do not stop here: call a tool again with valid arguments that satisfy this, or explain only if no valid option exists.`;
}

/** Whether `input` matches any of the intents. A throwing predicate counts as no match. */
export function matchesIntent(input: string, intents: ReadonlyArray<IntentMatcher>): boolean {
  const lowered = input.toLowerCase();

  return intents.some((intent) => {
    try {
      if (typeof intent === "string") return lowered.includes(intent.toLowerCase());
      if (typeof intent === "function") return intent(input);

      intent.lastIndex = 0;
      return intent.test(input);
    } catch {
      return false;
    }
  });
}

/** Whether the tool calls satisfy `requiredTools` under `require`. A failed call does not count. */
export function requiredToolsCalled(
  calls: ReadonlyArray<Pick<ToolCall, "name" | "status">>,
  requiredTools: ReadonlyArray<string>,
  require: "any" | "all" = "any",
): boolean {
  const called = new Set(calls.filter((call) => call.status !== "failed").map((call) => call.name));

  return require === "all"
    ? requiredTools.every((name) => called.has(name))
    : requiredTools.some((name) => called.has(name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The reason a finished tool call counts as a refusal, or `undefined`.
 * Default rule: a schema validation error, or a result object with
 * `refused: true` or `ok: false` that carries a `reason`, `error` or
 * `message` string.
 */
export function refusalReason(
  call: ToolCall,
  isRefusal?: ToolRefusalConfig["isRefusal"],
): string | undefined {
  if (isRefusal) {
    const verdict = isRefusal(call);

    return typeof verdict === "string" && verdict.length > 0 ? verdict : undefined;
  }

  if (call.error instanceof SchemaValidationError) return call.error.message;

  if (isRecord(call.output) && (call.output.refused === true || call.output.ok === false)) {
    for (const key of ["reason", "error", "message"] as const) {
      const value = call.output[key];

      if (typeof value === "string" && value.length > 0) return value;
    }
  }

  return undefined;
}

/** Normalize `onToolRefusal` to a config, or `undefined` when off. */
export function resolveRefusalConfig(
  option: ToolRefusalOption | undefined,
): (Required<Pick<ToolRefusalConfig, "retries">> & ToolRefusalConfig) | undefined {
  if (option === undefined || option === "off") return undefined;
  if (option === "retry-once-with-hint") return { retries: 1 };

  const retries = option.retries ?? 1;

  return retries > 0 ? { ...option, retries } : undefined;
}
