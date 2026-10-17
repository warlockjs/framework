# WR-039 — Stream reasoning deltas, tool-argument deltas and usage mid-trip

- **Packages:** `@warlock.js/ai` 5.30.0 (`ModelStreamChunk`, agent stream events), adapters
- **Classification:** feature request
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

`ModelStreamChunk` carries only `delta`, `tool-call` and `done`, so a UI cannot show the model thinking live, or a long tool input (a file being written) as it streams. Usage arrives only at `trip.completed`.

## Request

- `{ type: "reasoning", delta }` chunks plus an `agent.trip.reasoning` event, mapped for Anthropic thinking deltas, OpenAI reasoning summaries and Gemini thoughts where the provider exposes them.
- An optional `{ type: "tool-args", callId, delta }` chunk.
- An optional interim usage event when the provider streams one (Anthropic `message_delta`).
