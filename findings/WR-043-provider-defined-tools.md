# WR-043 — Provider-defined (server-side) tools

- **Packages:** `@warlock.js/ai`, `@warlock.js/ai-anthropic`, `@warlock.js/ai-openai` 5.30.0
- **Classification:** feature request
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

Providers ship their own tools: Anthropic `web_search`, `web_fetch`, text editor and memory; OpenAI `web_search`. `tools` accepts only framework tools, and the Anthropic adapter refuses `tools` inside `providerOptions.body`, so these cannot be enabled.

## Request

`tools: [ai.providerTool({ provider: "anthropic", definition: { type: "web_search_20250305", max_uses: 5 } })]`, passed through verbatim to that provider and ignored (with a warning) by others. Results surface as provider blocks (already round-tripped in 5.30).
