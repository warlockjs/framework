import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions, ModelContract } from "../contracts/model.contract";
import type { ToolConfig, ToolSchemaMode } from "../contracts/tool.contract";
import type { SkillsContract } from "../skills/contracts/skills.contract";
import { compactToolSchemas, measureTools } from "../tool/tool-schemas";
import { computeCost, totalCost } from "../utils/compute-cost";
import {
  countInputTokens,
  type EstimateInputTokensOptions,
  type InputTokenCount,
} from "../utils/estimate-input-tokens";

export type MeasureOptions = {
  model: Pick<ModelContract, "name" | "provider" | "pricing" | "countTokens">;
  tools?: ReadonlyArray<ToolConfig<unknown, unknown>>;
  /** Resolved system text, without the skills catalogue. */
  system?: string;
  messages?: ReadonlyArray<Message>;
  /** Catalogue text or a library. Bodies and library tools are not auto-injected. */
  skills?: string | Pick<SkillsContract, "catalogPrompt">;
  toolSchemas?: ToolSchemaMode;
  callOptions?: Omit<ModelCallOptions, "tools">;
  estimate?: Omit<EstimateInputTokensOptions, "tools" | "responseSchema">;
};

export type MeasurePart = InputTokenCount & {
  /** Uncached input USD per call. Absent when the model is unpriced. */
  costUSD?: number;
};

export type MeasureParts = Record<"messages" | "system" | "skills" | "tools", MeasurePart>;

export type Measurement = {
  model: string;
  provider: string;
  /** True when a user message containing "." supplied the counting context. */
  probe: boolean;
  parts: MeasureParts;
  total: MeasurePart;
};

export type MeasureDelta = {
  /** Signed after minus before. */
  tokens: number;
  /** Absent if either side is unpriced. */
  costUSD?: number;
};

export type MeasurementDiff = {
  before: Measurement;
  after: Measurement;
  parts: Record<keyof MeasureParts, MeasureDelta>;
  total: MeasureDelta;
};

/**
 * Measure a call without generating output. Native count endpoints may use the
 * network. Attribution is incremental: messages → system → skills → tools.
 * All parts use estimates if any request shape explicitly cannot be counted.
 * Authentication, transport and other provider errors propagate.
 */
export async function measure(options: MeasureOptions): Promise<Measurement> {
  const catalogue =
    typeof options.skills === "string"
      ? options.skills
      : ((await options.skills?.catalogPrompt()) ?? "");
  const probe = !options.messages?.length;
  const messages: Message[] = probe
    ? [{ role: "user", content: "." }]
    : [...(options.messages ?? [])];
  const withSystem = (text: string): Message[] =>
    text ? [{ role: "system", content: text }, ...messages] : messages;
  const system = options.system ?? "";
  // Match agent skills injection: catalogue precedes the resolved system text.
  const combined = [catalogue, system].filter(Boolean).join("\n\n");
  const tools =
    options.toolSchemas === "compact"
      ? compactToolSchemas(options.tools ?? [])
      : [...(options.tools ?? [])];
  const systemMessages = withSystem(system);
  const skillsMessages = catalogue ? withSystem(combined) : systemMessages;
  const stages = [messages, systemMessages, skillsMessages];
  const counts: InputTokenCount[] = [];
  const count = async (input: Message[], sentTools?: ToolConfig<unknown, unknown>[]) => {
    const result = await countInputTokens(options.model, input, {
      ...options.callOptions,
      ...(sentTools?.length ? { tools: sentTools } : {}),
      estimate: options.estimate,
    });
    if (!Number.isFinite(result.tokens) || result.tokens < 0) {
      throw new Error("countTokens must return a finite non-negative number.");
    }
    return result;
  };

  let previousInput: Message[] | undefined;
  let previousCount: InputTokenCount | undefined;
  for (const input of stages) {
    const result = input === previousInput && previousCount ? previousCount : await count(input);
    previousInput = input;
    previousCount = result;
    counts.push(result);
    if (result.source === "estimate") return estimateMeasurement();
  }
  const full = tools.length ? await count(skillsMessages, tools) : counts[2];
  if (!full || full.source === "estimate") return estimateMeasurement();
  const base = counts[0]?.tokens ?? 0;
  const withSystemTokens = counts[1]?.tokens ?? base;
  const withSkillsTokens = counts[2]?.tokens ?? withSystemTokens;
  return report(base, withSystemTokens, withSkillsTokens, full.tokens, "native");

  async function estimateMeasurement(): Promise<Measurement> {
    const estimated = await Promise.all(
      stages.map((input) =>
        countInputTokens({}, input, {
          ...options.callOptions,
          estimate: { ...options.estimate, tools: [] },
        }),
      ),
    );
    // Reuse the tool measurement heuristic, including its per-schema rounding.
    const toolCount = await measureTools(tools, { estimate: options.estimate });
    const baseTokens = estimated[0]?.tokens ?? 0;
    const systemTokens = estimated[1]?.tokens ?? baseTokens;
    const skillsTokens = estimated[2]?.tokens ?? systemTokens;
    return report(
      baseTokens,
      systemTokens,
      skillsTokens,
      skillsTokens + toolCount.tokens,
      "estimate",
    );
  }

  function report(
    base: number,
    systemTokens: number,
    skillsTokens: number,
    total: number,
    source: InputTokenCount["source"],
  ): Measurement {
    // Price signed marginal contributions without clamping negative deltas.
    const rate = totalCost(computeCost({ input: 1, output: 0, total: 1 }, options.model.pricing));
    const part = (tokens: number): MeasurePart => ({
      tokens,
      source,
      ...(rate === undefined ? {} : { costUSD: tokens * rate }),
    });
    return {
      model: options.model.name,
      provider: options.model.provider,
      probe,
      parts: {
        messages: part(base),
        system: part(systemTokens - base),
        skills: part(skillsTokens - systemTokens),
        tools: part(total - skillsTokens),
      },
      total: part(total),
    };
  }
}

/** Compare reports, preserving their model, provenance and probe information. */
measure.diff = function diff(before: Measurement, after: Measurement): MeasurementDiff {
  const delta = (left: MeasurePart, right: MeasurePart): MeasureDelta => ({
    tokens: right.tokens - left.tokens,
    ...(left.costUSD === undefined || right.costUSD === undefined
      ? {}
      : { costUSD: right.costUSD - left.costUSD }),
  });
  return {
    before,
    after,
    parts: {
      messages: delta(before.parts.messages, after.parts.messages),
      system: delta(before.parts.system, after.parts.system),
      skills: delta(before.parts.skills, after.parts.skills),
      tools: delta(before.parts.tools, after.parts.tools),
    },
    total: delta(before.total, after.total),
  };
};
