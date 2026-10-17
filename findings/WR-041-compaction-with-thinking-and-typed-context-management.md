# WR-041 — Compaction that works with thinking runs, plus typed context management

- **Packages:** `@warlock.js/ai` 5.30.0 (`agent/compaction.ts`), `@warlock.js/ai-anthropic` 5.30.0
- **Classification:** feature request (automatic compaction is already in NEXT-RELEASE §5; this adds two gaps)
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

- Compaction never runs when provider blocks or thinking replay are present (`provider-replay` skip). On Claude thinking runs it is therefore always off.
- The summarizer is always app-supplied, with no default prompt or cheap-model helper.
- Anthropic `context_management` (clear old tool uses) and server-side compaction are reachable only as untyped `providerOptions.anthropic.body`.

## Request

- When thinking blocks are present, compact everything before the last assistant turn and keep that turn's blocks intact (or drop thinking blocks from summarised turns, as the provider allows).
- `compaction: { afterTokens, summarizer: ai.compaction.summarize({ model }) }`, a built-in summariser with a tested prompt.
- Typed options: `contextManagement: { clearToolUses: { trigger, keep } }` and `serverCompaction: true` for Anthropic, ignored by other adapters with a debug log.

## Status note (2026-10-17)

`AgentConfig.compaction` exists in the framework source (unreleased 5.31 work, `packages/ai/src/agent/compaction.ts`)
but not in the published 5.30.0 that apps install. Until it ships, apps compact between turns only. The requests
above (thinking-safe compaction, a built-in summariser, typed context management) still apply to the 5.31
implementation.
