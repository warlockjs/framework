import { emptyRollupDelta } from "../../../src/ai/rollup";
import type { DevtoolsAiRollupDelta } from "../../../src/ai/types";

export const H = 3_600_000;

export function row(
  key: { hour: number; agent?: string; model?: string; provider?: string },
  counters: Partial<DevtoolsAiRollupDelta> = {},
): DevtoolsAiRollupDelta {
  const delta = emptyRollupDelta({
    hour: key.hour,
    agent: key.agent ?? "support",
    model: key.model ?? "gpt-4o",
    provider: key.provider ?? "openai",
  });

  return { ...delta, ...counters, errors: { ...delta.errors, ...counters.errors } };
}
