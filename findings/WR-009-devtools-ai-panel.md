# WR-009: devtools AI panel built on ai-panoptic traces (recommended for 5.33)

Date: 2026-10-19 · Packages: @warlock.js/devtools, @warlock.js/ai-panoptic · From: Bureau

**Request:** show `ai-panoptic` traces at `/__warlock`, per request and per run: the model, input, output and cache
tokens, cost, cache hits, tool calls with timings, retries, and truncation (`AgentIncompleteError`).

Both pieces exist, so this is mostly wiring. Bureau built its own run traces and usage pages to get this view.
