import { applyRedact, type LoggingData } from "@warlock.js/logger";
import type { ToolUseContractEvent } from "../agent/tool-use-contract";
import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions } from "../contracts/model.contract";
import type { LLMTrip } from "../contracts/result/llm-trip.type";
import type { ToolCall } from "../contracts/result/tool-call.type";
import type { Usage } from "../contracts/result/usage.type";
import { isDevRuntime } from "../utils/dev-runtime";
import { estimateInputTokens } from "../utils/estimate-input-tokens";
import { hashText, stableJson } from "../utils/hash-text";
import { extractJsonSchema } from "../utils/json-schema";
import { agentTraces } from "./agent-trace-store";
import type {
  AgentTrace,
  AgentTraceOptions,
  AgentTraceStatus,
  AgentTraceStore,
  AgentTraceToolCall,
  AgentTraceToolOffer,
  AgentTraceTurn,
} from "./agent-trace.type";

const DEFAULT_MAX_STRING_LENGTH = 8_000;
const MAX_VALUE_DEPTH = 8;

/** `AgentConfig.trace` resolved to concrete settings, or `undefined` when nothing is recorded. */
export type ResolvedTraceOptions = {
  text: boolean;
  redact: AgentTraceOptions["redact"];
  maxStringLength: number;
  store: AgentTraceStore;
};

/**
 * Turn `AgentConfig.trace` into settings. Default (no option): record in
 * development, with text; nothing under test or in production. `true`
 * records everywhere, keeping text only in development; `false` records
 * nothing.
 */
export function resolveTraceOptions(
  option: boolean | AgentTraceOptions | undefined,
): ResolvedTraceOptions | undefined {
  const dev = isDevRuntime();
  const config: AgentTraceOptions = typeof option === "object" ? option : {};
  const enabled = option === false ? false : (config.enabled ?? (option === true ? true : dev));

  if (!enabled) return undefined;

  return {
    text: config.text ?? dev,
    redact: config.redact,
    maxStringLength: config.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
    store: config.store ?? agentTraces,
  };
}

function capStrings(value: unknown, max: number, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, max)}...[${value.length - max} more characters]` : value;
  }

  if (depth >= MAX_VALUE_DEPTH || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((entry) => capStrings(entry, max, depth + 1));

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, capStrings(entry, max, depth + 1)]),
  );
}

/** A JSON-safe copy of `value` with long strings cut; `undefined` stays `undefined`. */
function safeValue(value: unknown, max: number): unknown {
  if (value === undefined) return undefined;

  try {
    const copy: unknown = JSON.parse(JSON.stringify(value) ?? "null");

    return capStrings(copy, max);
  } catch {
    return capStrings(String(value), max);
  }
}

function errorSummary(error: unknown): { type: string; message: string } | undefined {
  if (!error) return undefined;

  if (error instanceof Error) {
    return { type: error.name, message: error.message };
  }

  return { type: "Error", message: String(error) };
}

/** The text of every system message, in order. */
function systemTextOf(messages: ReadonlyArray<Message>): string | undefined {
  const parts: string[] = [];

  for (const message of messages) {
    if (message.role !== "system") continue;

    if (typeof message.content === "string") {
      parts.push(message.content);
    } else {
      for (const part of message.content) {
        if (part.type === "text") parts.push(part.text);
      }
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

type RecorderInit = {
  runId: string;
  agent: string;
  version?: string;
  model: { name: string; provider: string };
  sessionId?: string;
  input: string;
  options: ResolvedTraceOptions;
};

/**
 * Builds the {@link AgentTrace} of one run as the agent loop reports its
 * steps, and publishes a redacted copy to the store after each turn. Internal
 * to the agent; the run never depends on it (every method swallows errors).
 */
export class AgentTraceRecorder {
  private readonly trace: AgentTrace;
  private turn?: AgentTraceTurn;
  private readonly early: ToolUseContractEvent[] = [];
  private readonly offers = new WeakMap<object, AgentTraceToolOffer>();

  public constructor(private readonly init: RecorderInit) {
    this.trace = {
      schemaVersion: 1,
      runId: init.runId,
      agent: init.agent,
      ...(init.version ? { version: init.version } : {}),
      model: init.model,
      ...(init.sessionId ? { sessionId: init.sessionId } : {}),
      startedAt: new Date().toISOString(),
      status: "running",
      input: String(safeValue(init.input, init.options.maxStringLength)),
      toolSchemas: {},
      turns: [],
      usage: { input: 0, output: 0, total: 0 },
    };
  }

  /** Begin a turn: what the model is about to receive. */
  public startTurn(
    index: number,
    tripInput: string,
    messages: ReadonlyArray<Message>,
    callOptions: ModelCallOptions,
  ): void {
    this.guard(() => {
      const system = systemTextOf(messages);
      const toolsOffered = this.offerTools(callOptions);

      if (system !== undefined && !this.trace.systemPrompt) {
        this.trace.systemPrompt = {
          hash: hashText(system),
          ...(this.init.options.text ? { text: system } : {}),
        };
      }

      this.turn = {
        index,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        input: tripInput,
        ...(system !== undefined ? { systemPromptHash: hashText(system) } : {}),
        toolsHash: hashText(stableJson(toolsOffered.map((tool) => [tool.name, tool.schemaHash]))),
        toolsOffered,
        toolCalls: [],
        usage: { input: 0, output: 0, total: 0 },
        contract: this.early.splice(0),
      };
      this.trace.turns.push(this.turn);
      this.publish();
    });
  }

  /** Record a finished tool call on the current turn. */
  public toolCall(call: ToolCall, refusal?: string): void {
    this.guard(() => {
      if (!this.turn) return;

      const max = this.init.options.maxStringLength;
      const record: AgentTraceToolCall = {
        ...(call.callId ? { callId: call.callId } : {}),
        name: call.name,
        status: call.status,
        durationMs: call.duration,
        input: safeValue(call.input, max),
        ...(call.output !== undefined ? { output: safeValue(call.output, max) } : {}),
        ...(call.error ? { error: errorSummary(call.error) } : {}),
        ...(refusal ? { refusal } : {}),
      };

      this.turn.toolCalls.push(record);
    });
  }

  /** Record something the tool-use contract did on the current turn. */
  public contractEvent(event: ToolUseContractEvent): void {
    this.guard(() => {
      if (!this.turn) {
        // Before the first turn starts (a "before" backstop): held for it.
        this.early.push(event);
        return;
      }

      this.turn.contract.push(event);
      this.publish();
    });
  }

  /** Close the current turn with the recorded trip. */
  public endTurn(trip: LLMTrip): void {
    this.guard(() => {
      if (!this.turn) return;

      this.turn.durationMs = trip.duration;
      this.turn.finishReason = trip.finishReason;
      this.turn.usage = { ...trip.usage };
      if (trip.usage.cost !== undefined) this.turn.cost = trip.usage.cost;
      if (this.init.options.text) {
        this.turn.text = String(safeValue(trip.output, this.init.options.maxStringLength));
      }
      if (trip.error) this.turn.error = errorSummary(trip.error);

      // The turn stays current: contract actions decided after the trip
      // (a re-prompt, an after-turn backstop) still belong to it.
      this.publish();
    });
  }

  /** Close the run. */
  public finish(outcome: {
    status: AgentTraceStatus;
    usage: Usage;
    error?: unknown;
  }): void {
    this.guard(() => {
      this.turn = undefined;
      this.trace.status = outcome.status;
      this.trace.endedAt = new Date().toISOString();
      this.trace.durationMs = Date.parse(this.trace.endedAt) - Date.parse(this.trace.startedAt);
      this.trace.usage = { ...outcome.usage };
      if (outcome.usage.cost !== undefined) this.trace.cost = outcome.usage.cost;
      if (outcome.error) this.trace.error = errorSummary(outcome.error);
      this.publish();
    });
  }

  private offerTools(callOptions: ModelCallOptions): AgentTraceToolOffer[] {
    const offers: AgentTraceToolOffer[] = [];

    for (const tool of callOptions.tools ?? []) {
      let offer = this.offers.get(tool);

      if (!offer) {
        let parameters: unknown = null;

        try {
          parameters = extractJsonSchema(tool.input) ?? null;
        } catch {
          // A schema that cannot be extracted is sent as no parameters.
        }

        const schemaHash = hashText(
          stableJson({ name: tool.name, description: tool.description, parameters }),
        );

        offer = {
          name: tool.name,
          schemaHash,
          tokens: estimateInputTokens([], { tools: [tool], perMessageTokens: 0 }),
        };
        this.offers.set(tool, offer);
        this.trace.toolSchemas[schemaHash] ??= {
          name: tool.name,
          description: tool.description,
          ...(this.init.options.text ? { schema: JSON.stringify(parameters) } : {}),
        };
      }

      offers.push(offer);
    }

    for (const provider of callOptions.providerTools ?? []) {
      const definition = provider.definition as Record<string, unknown>;
      const name = `${provider.provider}:${String(definition.name ?? definition.type ?? "tool")}`;
      const schemaHash = hashText(stableJson(provider));

      offers.push({ name, schemaHash, tokens: 0 });
      this.trace.toolSchemas[schemaHash] ??= {
        name,
        description: "Provider-defined tool, sent verbatim.",
        ...(this.init.options.text ? { schema: stableJson(definition) } : {}),
      };
    }

    return offers;
  }

  private publish(): void {
    const copy = structuredClone(this.trace);
    const data: LoggingData = {
      type: "info",
      module: "ai.trace",
      action: "run",
      message: copy,
    };
    const redacted = applyRedact(data, this.init.options.redact).message as AgentTrace;

    this.init.options.store.publish(redacted);
  }

  private guard(action: () => void): void {
    try {
      action();
    } catch {
      // Tracing is a development aid: it must never fail or slow a run.
    }
  }
}
