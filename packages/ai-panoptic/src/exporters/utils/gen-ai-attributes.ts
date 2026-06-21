import type { TraceSpan } from "../../contracts";
import { totalCostUsd } from "./total-cost";

/**
 * Subset of the OpenTelemetry GenAI semantic-convention attribute keys
 * Panoptic emits. Kept as a named constant map (not inline string
 * literals scattered through the mapper) so the convention names live in
 * one place and a convention bump is a single edit.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export const GEN_AI_ATTRIBUTES = {
  operationName: "gen_ai.operation.name",
  system: "gen_ai.system",
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  conversationId: "gen_ai.conversation.id",
} as const;

/**
 * Panoptic-specific attribute keys that have no GenAI-convention
 * equivalent. Namespaced under `warlock.*` so they never collide with a
 * future `gen_ai.*` key the spec might add.
 */
export const WARLOCK_ATTRIBUTES = {
  reportType: "warlock.report.type",
  version: "warlock.version",
  durationMs: "warlock.duration_ms",
  totalTokens: "gen_ai.usage.total_tokens",
  cachedTokens: "gen_ai.usage.cached_tokens",
  reasoningTokens: "gen_ai.usage.reasoning_tokens",
  costUsd: "warlock.cost.usd",
} as const;

/**
 * Span attribute values an OpenTelemetry / Langfuse backend accepts.
 * GenAI attributes are scalars; the framework's free-form
 * `TraceSpan.attributes` may also carry these.
 */
export type AttributeValue = string | number | boolean;

/**
 * Project a {@link TraceSpan} onto the OpenTelemetry GenAI
 * semantic-convention attribute set.
 *
 * The vendor-neutral {@link TraceSpan} carries identity, timing, status,
 * and rolled-up `usage` as first-class fields; model identity and other
 * provider detail live in the free-form `attributes` bag the collector
 * populated. This mapper folds both into a flat `gen_ai.*` /
 * `warlock.*` attribute map ready to set on an OTel span or hand to a
 * Langfuse generation.
 *
 * - `gen_ai.operation.name` / `gen_ai.system` / `gen_ai.request.model`
 *   are forwarded from the span's `attributes` when the collector set
 *   them; never invented here.
 * - Token counts come from the span's typed `usage` rollup.
 * - The free-form `attributes` are merged last so an explicit collector
 *   value wins over a derived one.
 *
 * @example
 * const attributes = toGenAiAttributes(span);
 * // { "gen_ai.usage.input_tokens": 150, "gen_ai.usage.output_tokens": 320, ... }
 */
export function toGenAiAttributes(span: TraceSpan): Record<string, AttributeValue> {
  const attributes: Record<string, AttributeValue> = {
    [WARLOCK_ATTRIBUTES.reportType]: span.type,
    [WARLOCK_ATTRIBUTES.durationMs]: span.duration,
    [WARLOCK_ATTRIBUTES.totalTokens]: span.usage.total,
    [GEN_AI_ATTRIBUTES.usageInputTokens]: span.usage.input,
    [GEN_AI_ATTRIBUTES.usageOutputTokens]: span.usage.output,
  };

  if (span.version !== undefined) {
    attributes[WARLOCK_ATTRIBUTES.version] = span.version;
  }

  if (span.sessionId !== undefined) {
    attributes[GEN_AI_ATTRIBUTES.conversationId] = span.sessionId;
  }

  if (span.usage.cachedTokens !== undefined) {
    attributes[WARLOCK_ATTRIBUTES.cachedTokens] = span.usage.cachedTokens;
  }

  if (span.usage.reasoningTokens !== undefined) {
    attributes[WARLOCK_ATTRIBUTES.reasoningTokens] = span.usage.reasoningTokens;
  }

  const cost = totalCostUsd(span.usage);

  if (cost !== undefined) {
    attributes[WARLOCK_ATTRIBUTES.costUsd] = cost;
  }

  mergeScalarAttributes(attributes, span.attributes);

  return attributes;
}

/**
 * Copy the scalar entries of a free-form attribute bag onto the target
 * map. Non-scalar values (objects, arrays, functions) are skipped — OTel
 * and Langfuse attribute values must be primitives, and the collector's
 * bag may legitimately hold nested digests that don't belong on a span
 * attribute. Explicit collector values overwrite derived ones.
 */
function mergeScalarAttributes(
  target: Record<string, AttributeValue>,
  source: Record<string, unknown> | undefined,
): void {
  if (!source) {
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      target[key] = value;
    }
  }
}
