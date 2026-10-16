# WR-029 — `spawnSubAgent` cannot choose tool dispatch after the 5.30 concurrent default

- **Packages:** `@warlock.js/ai` 5.30.0 (`spawnSubAgent`, `SpawnSubAgentSpec`)
- **Classification:** feature request / API gap made visible by a breaking default
- **Found:** 2026-10-16, while upgrading an app's `spawn_subagent` tool to 5.30.

## Expected

5.30 made `toolDispatch: "concurrent"` the default and added `toolDispatch` and
`maxConcurrentTools` to `AgentConfig` and `AgentExecuteOptions`. `spawnSubAgent`, the documented
one-shot helper, should accept the same two options, so a caller that needs ordered tool calls can
keep using the helper.

## Observed

`SpawnSubAgentSpec` has `name`, `model`, `systemPrompt`, `tools`, `maxTrips`, `budget`, `output`,
`signal`, `sessionId` and `task`, and nothing else. `buildSubAgent` passes only those fields to
`agent()`. A sub-agent spawned with the helper therefore always runs its tool calls concurrently, up
to 4 at once. The only way to opt out is to stop using the helper and rebuild it by hand:

```ts
agent({ ...config, toolDispatch: "sequential", middleware: [budget({ maxTokens })] })
  .execute(task, { signal });
```

## Why it matters

A host app that keys tool calls by sequence number (idempotency keys, an ordered audit journal,
"stop at the first failure", a closing tool) silently changes behaviour on upgrade: the helper gives
no type error and no runtime warning. The 5.30 changelog lists the concurrent default as breaking
for `AgentConfig`, but `spawnSubAgent` callers are not told they have no way to restore the old behaviour.

## Requests

- Add `toolDispatch?: ToolDispatchMode` and `maxConcurrentTools?: number` to `SpawnSubAgentSpec`
  and forward them in `buildSubAgent`.
- Mention `spawnSubAgent` in the 5.29 → 5.30 upgrade notes.

## Workaround in the app

`spawn_subagent` now calls `ai.agent({... toolDispatch: "sequential", middleware: [budget({ maxTokens })] }).execute(task, { signal })`.
This is equivalent to `buildSubAgent` in 5.30.0.
