# WR-054: A run cut off by the output limit ends as a success, and Anthropic's default cap is 4096

- **Packages:** `@warlock.js/ai` 5.30.0 (agent run status), `@warlock.js/ai-anthropic` 5.30.0 (default `maxTokens`)
- **Classification:** bug (silent success) plus a request (default)
- **Found:** 2026-10-17, in Bureau's live acceptance with a real Anthropic key (Haiku workers writing files).

## What happens

1. A worker asked the model to write a file. The model's `write_file` tool call was still being generated when
   the response hit `max_tokens`. The trip's `finishReason` was `"length"`, no tool call was emitted, and the agent
   run ended with `error` unset and empty `text`. To the host it looks exactly like a model that finished and had
   nothing to say. Bureau reported "the worker exited without reporting".
2. `AnthropicSDK` sends `max_tokens: 4096` when the caller sets none. That is low for agent work: one medium file in
   a single `write_file` call exceeds it.

`report.trips.at(-1).finishReason` does carry `"length"`, so Bureau now checks it after every run. Every host would
need the same check to avoid the silent-success trap.

## Request

- When the final trip's finish reason is `"length"` (or `"context_exceeded"`), end the run with a typed error such
  as `AgentIncompleteError { reason: "output_limit" | "context_window", tripIndex }`, or at least set
  `report.status: "incomplete"`, rather than a clean success. Optionally allow one automatic continuation (the
  usual "continue" turn) behind an agent option.
- Raise the Anthropic adapter's default `maxTokens` for agent use (for example 16384), or derive it from the
  model's documented output limit, and document the default.
