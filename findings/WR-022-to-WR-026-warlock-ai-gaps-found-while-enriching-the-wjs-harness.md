# WR-022 to WR-026: Warlock AI gaps found while enriching the WJS harness

Packages: `@warlock.js/ai` 5.29.0 and `@warlock.js/ai-anthropic` 5.29.0, Node 22.13.0.
Classification: feature requests and one clarification, from source review of the
installed packages during the 2026-10-15 harness work. No paid calls were made.

- WR-022: `ModelResponse` is `{content, finishReason, usage, toolCalls}`.
  `agent/agent.mjs` `runTrip` rebuilds the assistant message from `content` and
  `toolCalls` only, so thinking, redacted_thinking and compaction blocks cannot
  round-trip. Preserved thinking and server compaction both require that. Workaround:
  the Bureau transcript keeps full `blocks` beside the reply.
- WR-023: `FinishReason` is `stop | tool_calls | length | error`. `pause_turn`,
  `refusal` and `model_context_window_exceeded` must stay distinct. Workaround:
  `classifyStopReason` reads the raw receipt.
- WR-024: `runTrip` awaits `dispatchToolCall` in a `for` loop. Request:
  concurrent dispatch with all results returned in one user message. Workaround:
  Bureau's harness dispatches concurrently and merges results.
- WR-025: `ModelCallOptions` cannot express `context_management` edits,
  compaction, `fallbacks`, cache TTL (only `{breakpoints}`), `thinking.display`,
  `count_tokens` or beta headers. Workaround: Bureau's own serializer, with the
  beta header derived from the hashed body.
- WR-026: `ai-anthropic/esm/model.mjs` `buildThinking`/`inferThinkingMode` emit
  enabled/budget forms. Opus 5.5, Sonnet 5.5 and Fable 5.1 reject
  `budget_tokens` and `disabled`. Clarify the adaptive-only path. Bureau does not
  use the adapter on the wire.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
