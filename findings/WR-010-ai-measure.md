# WR-010: ai.measure() — the per-call token cost of tools, system prompts and skills catalogues (recommended for 5.33)

Date: 2026-10-19 · Package: @warlock.js/ai · From: Bureau

**Today:** anything an agent carries (tool schemas, the system prompt, a skills catalogue) is charged on every call.
Bureau's instructions require *measured* deltas, because estimates of characters divided by four were wrong by 4x in
both directions. The measuring script was removed together with the old daemon.

**Request:** `ai.measure({ model, tools, system, messages })`, built on the existing `countTokens` /
`countInputTokens`. It returns tokens and USD per call for each part, and a before/after diff. Add a CLI form,
`warlock ai measure`.
