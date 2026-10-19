import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions, ModelContract } from "../contracts/model.contract";
import type { ToolConfig, ToolSchemaMode } from "../contracts/tool.contract";
import {
  estimateInputTokens,
  type EstimateInputTokensOptions,
} from "../utils/estimate-input-tokens";
import { type CompactJsonSchemaOptions, withCompactJsonSchema } from "../utils/json-schema";
import { mapWithConcurrency } from "../utils/map-with-concurrency";

/**
 * Return copies of `tools` whose input schemas serialize in compact form
 * (see {@link compactJsonSchema}) for every adapter. Validation still
 * runs against the original schema, and the tool's `description` is kept.
 * The originals are not modified.
 *
 * @example
 * await model.complete(messages, { tools: compactToolSchemas([searchTool, weatherTool]) });
 */
export function compactToolSchemas<TTool extends ToolConfig<unknown, unknown>>(
  tools: ReadonlyArray<TTool>,
  options: CompactJsonSchemaOptions = {},
): TTool[] {
  return tools.map((tool) => ({ ...tool, input: withCompactJsonSchema(tool.input, options) }));
}

/** Options for {@link measureTools}. */
export type MeasureToolsOptions = {
  /**
   * The model the tools will be sent to. When it has a native count
   * endpoint (`countTokens`: Anthropic, Google, Bedrock, OpenAI
   * Responses), the counts are exact for that model; otherwise they are
   * estimates. Omit it to always estimate.
   */
  model?: Pick<ModelContract, "countTokens">;
  /** Measure the schemas as sent in this mode. Default `"full"`. */
  mode?: ToolSchemaMode;
  /** Options forwarded to `model.countTokens` (e.g. `providerOptions`). */
  callOptions?: Omit<ModelCallOptions, "tools">;
  /** Tuning for the estimate path — see {@link estimateInputTokens}. */
  estimate?: Pick<EstimateInputTokensOptions, "charsPerToken">;
  /** Native count calls in flight at once. Default `4`. */
  concurrency?: number;
};

/** One tool's share of the measurement. */
export type ToolTokenCount = {
  name: string;
  /**
   * Tokens this tool adds to a request. Natively, the drop in the total
   * when only this tool is removed; estimated, its own schema JSON.
   */
  tokens: number;
};

/** The result of {@link measureTools}. */
export type ToolTokenMeasurement = {
  /** Tokens the whole tool list adds to every request. */
  tokens: number;
  /** Per-tool contribution, in input order. */
  perTool: ToolTokenCount[];
  /**
   * Tokens a provider adds once whenever any tool is present (Anthropic's
   * tool-use preamble, for example): `tokens` minus the sum of `perTool`.
   * Always `0` for an estimate.
   */
  overhead: number;
  /** `"native"` — counted by the model's count endpoint; `"estimate"` — character heuristic. */
  source: "native" | "estimate";
  /** The schema mode that was measured. */
  mode: ToolSchemaMode;
};

/**
 * Measure how many input tokens a tool list costs on every call — often
 * the largest fixed part of an agent turn. Available as
 * `ai.tools.measure(tools, options)` in AI core.
 *
 * **Native** (the model has `countTokens`): counts a one-message probe
 * with no tools, with all tools, and with each tool left out, so
 * `tokens` is exact for that model and each `perTool` entry is the tool's
 * marginal cost. That is `tools.length + 2` count calls (free on the
 * providers that offer them, but rate-limited), run `concurrency` at a
 * time.
 *
 * **Estimate** (no `countTokens`, or no `model`): each tool's schema JSON
 * at `charsPerToken` characters per token. `source` says which was used.
 *
 * @example
 * const report = await measureTools(tools, { model, mode: "compact" });
 * console.log(report.tokens, report.source, report.perTool);
 */
export async function measureTools(
  tools: ReadonlyArray<ToolConfig<unknown, unknown>>,
  options: MeasureToolsOptions = {},
): Promise<ToolTokenMeasurement> {
  const mode = options.mode ?? "full";
  const sent = mode === "compact" ? compactToolSchemas(tools) : [...tools];
  const countTokens = options.model?.countTokens?.bind(options.model);

  if (!countTokens || sent.length === 0) {
    const charsPerToken = options.estimate?.charsPerToken;
    const perTool = sent.map((tool) => ({
      name: tool.name,
      tokens: estimateInputTokens([], {
        tools: [tool],
        ...(charsPerToken !== undefined ? { charsPerToken } : {}),
      }),
    }));

    return {
      tokens: perTool.reduce((sum, entry) => sum + entry.tokens, 0),
      perTool,
      overhead: 0,
      source: "estimate",
      mode,
    };
  }

  const probe: Message[] = [{ role: "user", content: "." }];
  const count = (subset: ToolConfig<unknown, unknown>[]): Promise<number> =>
    countTokens(probe, { ...options.callOptions, ...(subset.length > 0 ? { tools: subset } : {}) });

  const variants: ToolConfig<unknown, unknown>[][] = [
    [],
    sent,
    ...sent.map((omitted) => sent.filter((tool) => tool !== omitted)),
  ];
  const counts = await mapWithConcurrency(variants, options.concurrency ?? 4, count);
  const baseline = counts[0] ?? 0;
  const all = counts[1] ?? baseline;
  const perTool = sent.map((tool, index) => ({
    name: tool.name,
    tokens: Math.max(0, all - (counts[index + 2] ?? all)),
  }));
  const tokens = Math.max(0, all - baseline);

  return {
    tokens,
    perTool,
    overhead: Math.max(0, tokens - perTool.reduce((sum, entry) => sum + entry.tokens, 0)),
    source: "native",
    mode,
  };
}
