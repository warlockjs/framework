import { judgePromptBody } from "@warlock.js/ai";
import type { EvaluateConfig, EvaluateVerdict } from "./evaluate.type";

/**
 * Grade `systemPrompt` with the configured judge model, reusing
 * `ai.prompts().validate()`'s own `judgePromptBody` — never a second
 * judging implementation. `instructionsOverride` (the dashboard's
 * per-run textarea) wins over `config.instructions`; with neither, the
 * judge falls back to `judgePromptBody`'s built-in prompt-quality rubric.
 *
 * The judge itself never throws (`judgePromptBody` degrades to an
 * issues-only outcome on failure) — the only thing that CAN throw here is
 * resolving `config.model` (a factory constructing an SDK client), which
 * the caller (the dashboard route) is expected to catch.
 */
export async function evaluateSystemPrompt(
  systemPrompt: string,
  config: EvaluateConfig,
  instructionsOverride?: string,
): Promise<EvaluateVerdict> {
  const model = typeof config.model === "function" ? await config.model() : config.model;
  const instructions = instructionsOverride?.trim() || config.instructions;

  return judgePromptBody(systemPrompt, model, instructions);
}
