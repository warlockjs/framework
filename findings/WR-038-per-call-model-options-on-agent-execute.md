# WR-038 — Per-call model options on `agent.execute` / `agent.stream`

- **Package:** `@warlock.js/ai` 5.30.0 (`agent/agent.ts` ~1128)
- **Classification:** feature request
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

`AgentExecuteOptions` has no `modelOptions`. Effort, `maxTokens`, `cacheControl` (TTL, breakpoints) and `providerOptions` are fixed per agent instance. A host that serves many turns with different settings (owner picks effort per member, longer cache TTL for long sessions) must build a new agent per turn. The Anthropic skill's `execute(..., { reasoning })` example does not match the implementation.

## Request

`execute(input, { modelOptions })` and `stream(input, { modelOptions })`, shallow-merged over the agent's config for that run. Fix the skill example.
