# WR-030 — Anthropic adapter: the request body cannot be built or bound before sending

- **Packages:** `@warlock.js/ai-anthropic` 5.30.0 (`AnthropicModel`), `@warlock.js/ai` 5.30.0
- **Classification:** feature request
- **Found:** 2026-10-16, while evaluating whether an app could replace its own Anthropic request
  serializer with the 5.30 adapter now that it round-trips provider blocks, maps
  `pause_turn`/`refusal`/`context_exceeded`, and takes `providerOptions`, `cacheControl.ttl` and
  `countTokens()`.

## Context

Apps with spend controls or audit trails reserve spend against the exact request before it is sent,
and record a hash of the body that was actually sent. The reservation, a preflight check and the
stored evidence all depend on those bytes. Such an app cannot use `AnthropicModel.complete()` or
`stream()`: the body is assembled inside the call, and nothing returns it beforehand.

## Observed

- `AnthropicModel` exposes only `complete(messages, options)`, `stream(messages, options)` and
  `countTokens(messages, options)`. The message, tool and block conversion lives in internal
  `utils/to-anthropic-messages`, `to-anthropic-tools` and `provider-blocks`, which are not exported.
- There is no dry-run or `buildRequest()`. A caller cannot get the body the adapter would send for
  given `messages` and `options` (thinking arm, `context_management` from `providerOptions.anthropic.body`,
  cache breakpoints, merged tool results), and so cannot hash, reserve or verify it.
- After the call, `ModelResponse` does not say which request bytes were sent.

## Requests

1. A public, side-effect-free `buildRequest(messages, options)` (or `toRequestBody`) on
   `AnthropicModel` that returns `{ endpoint: "messages" | "beta.messages", body, betas }` exactly as
   `complete()`/`stream()` would send it.
2. A way to send a previously built body: `complete({ body })` or `send(request)`, so the hashed bytes
   are the bytes sent. Optionally a hook (`onRequest(body)`) that can reject before the network call.
3. Export the message, tool and provider-block converters, so hosts that keep their own transport can
   reuse the framework's replay rules, including the 5.30 security check that replays only block types
   Claude returns on assistant turns.

## Impact and workaround

The app keeps its own Anthropic serializer: request building, wire rules per model, cache
breakpoints, tool-result merging, count-tokens body and stop-reason classification. The 5.30
adapter features stay unused on that path. On the paths that do use `ai.agent`, the new blocks and
finish reasons are not read.
