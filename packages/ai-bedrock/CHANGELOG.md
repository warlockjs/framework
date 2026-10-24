# Changelog — @warlock.js/ai-bedrock

All notable changes to `@warlock.js/ai-bedrock` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.37.1

### Changed

- Peer and runtime dependencies on other `@warlock.js/*` packages are now published as the same-major range `^5.37.1` instead of the exact version. npm 10 could not step the family in an existing `package-lock.json` (`ERESOLVE` on the exact, cyclic peer pins). Every package still ships at the same version; `warlock check` (`WL8010`) reports an installed set that has drifted apart.

## 5.34.3 - 2026-10-20

### Changed

- The agent skill now exports as `warlock-js-ai-bedrock`; package discovery descriptions stay within 450 characters.

## 5.34.2 - 2026-10-19

### Fixed

- Replace the loose skill catalog with a package index that points to the provider setup topic, and include orientation in generated LLM projections.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

### Fixed

- Verified that native token counting preserves the shared unsupported-count signal for `countInputTokens` estimation while authentication errors propagate.
- Clarify that Converse TokenUsage exposes no hosted-search request counter; system-tool blocks cannot establish request fees and no count is fabricated.

## 5.31.0 - 2026-10-18

### Fixed

- Usage is marked `inputIncludesCache: false` (Converse `inputTokens` excludes cache reads and writes) and reports 1-hour cache writes from `cacheDetails` in `cacheWrite1hTokens`, so cost bills each cache token once at its own rate.
- A `toolUse` block with `type: "server_tool_use"` (a system tool run by Bedrock) is no longer returned as a tool call for the agent to dispatch.
- Converse conversion compiles with strict indexed-access checks while preserving empty and system-only histories.
- Provider body options merge plain-object fields one level deep, preserving neutral reasoning, generation and structured-output settings unless the caller overrides their keys.
- Converse conversion combines adjacent same-role turns in content order, preserving parallel tool results and automatic compaction summaries beside assistant tool calls.

### Added

- With a `cacheControl` breakpoint, a `cachePoint` is also placed after the system prompt and, for Claude, after the tool definitions — the prefix segments Bedrock caches in `tools` → `system` → `messages` order. `ttl: "1h"` (per call, or the new `promptCacheTtl` model option) is sent only to models that accept it.
- Built-in Claude prices for `global.` and `us.` inference profiles (`BEDROCK_GLOBAL_PRICING`, `BEDROCK_US_PRICING`, `bedrockPricingFor`), from AWS's Bedrock price list as of 2026-10-17; caller pricing for Claude models gets the 1.25x / 2x cache-write rates filled (`withClaudeCacheWriteRates`). `complete()` and the streaming `done` chunk attach `usage.cost` when priced.
- Claude 5 families and Nova 2 Lite are recognised as prompt-caching capable.
- `ServiceUnavailableException` throws `ProviderOverloadedError`; wrapped errors carry `status`, `billed` and `retryable`.
- `new BedrockSDK({ apiKey, region })` authenticates with an Amazon Bedrock API key: requests carry `Authorization: Bearer <apiKey>` instead of a SigV4 signature and the AWS credential chain is not consulted (the adapter sets the AWS SDK's `token` and `authSchemePreference: ["httpBearerAuth"]`). An empty key, or a key combined with `credentials` or `token`, throws `InvalidRequestError`.
- An adapter contract test verifies that aborting `signal` rejects `complete()` and `stream()` and cancels the HTTP/2 request.
- With `streamChunks`, `stream()` yields `reasoning` for `reasoningContent.text` deltas and `tool-args` for client `toolUse.input` deltas.
- `ai.providerTool({ provider: "bedrock", definition })` appends a Converse `Tool` member such as `{ systemTool: { name: "nova_grounding" } }` verbatim; other providers' tools are skipped with a warning.
- `providerOptions.bedrock.body` forwards native per-call request options for completions and streams while protecting the model, conversation and tool definitions.
- Models expose native `countTokens()` preflight using the generation request's Converse conversation, tools and additional model fields.

### Upgrading

- Calls that ask for `cacheControl` breakpoints now also write the system prompt and (Claude) tool definitions to the cache. Writes cost more than plain input on the first call; repeated prefixes then read at the cache rate.

## 5.29.0 - 2026-10-01

### Changed

- Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.26.0 - 2026-09-30

### Changed

- Map all neutral reasoning effort levels to valid Bedrock extended-thinking budgets.

## 5.24.0 - 2026-09-27

### Fixed

- Preserve Claude extended-thinking reasoning blocks across Bedrock Converse tool-use follow-ups, and enforce valid thinking budgets and output-token ceilings.

## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.3.0 - 2026-06-21

### Added

- **Cost-truth capabilities** — `reasoning`, `promptCaching`, `pdf`, and `audio` are reported truthfully per model family (inferred from the model id, overridable via `bedrock.model(...)`).
- **Reasoning / extended thinking** — `ModelCallOptions.reasoning` maps to Converse `thinking` for reasoning-capable models, and no-ops elsewhere so unsupported params never reach the wire.
- **Prompt-cache write breakpoints** — `cacheControl.breakpoints` appends a Converse `cachePoint` block for caching-capable models.
- **`Usage.cacheWriteTokens`** populated from Converse `cacheWriteInputTokens`; `reasoningTokens` is left unset (Bedrock reports no reasoning channel).

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
