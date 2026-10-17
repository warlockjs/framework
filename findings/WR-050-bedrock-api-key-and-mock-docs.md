# WR-050 — Bedrock API-key auth; `MockModel` tool-call docs

- **Packages:** `@warlock.js/ai-bedrock` 5.30.0, `@warlock.js/ai` 5.30.0 (`MockModel`)
- **Classification:** feature request / docs
- **Found:** 2026-10-17.

1. **`BedrockSDK` documents only the AWS credential chain.** Bedrock now also accepts API keys (bearer). An app
   storing one key per provider has to pass `token` with `authSchemePreference: ["httpBearerAuth"]` by hand
   (untested). Request: `new BedrockSDK({ apiKey, region })`.
2. **`MockModel` ignores scripted tool calls** unless the response also sets `finishReason: "tool_calls"`. Document
   it, or infer `tool_calls` when `toolCalls` is non-empty.
3. **Adapters may ignore `ModelCallOptions.signal`** (the mock does, and the docs allow it), so hosts must race
   streams against their own abort. Request: make honouring `signal` part of the adapter contract and its tests.
