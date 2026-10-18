# WR-004: native search billing counters and compatible-provider controls are lost

Date: 2026-10-18
Packages: @warlock.js/ai*, 5.31.0
Observed in: Bureau B9, installed SDK source and contracts (no paid search call)

Provider tools are forwarded, but ModelResponse/StreamChunk/Usage have no native search billing counters. Anthropic's server_tool_use.web_search_requests is discarded by extractUsage; Google's groundingMetadata/webSearchQueries is not exposed; OpenAI Responses hosted output items are not retained as provider blocks. Therefore an application cannot add per-search fees to exact token costs from normalized usage. Counting model-visible function calls is incorrect: hosted tools execute on the provider.

Compatible controls also differ: Qwen enable_search is a request flag, not a tool definition. Kimi builtin_function/$web_search needs the provider's client continuation (echoing the supplied arguments); xAI native web_search uses Responses, whereas XaiSDK wraps the Chat Completions model. ai.providerTool alone does not make these transports equivalent.

Requested: normalized additive billing units (per-search/provider-specific requests), preserved raw grounding/hosted-tool metadata, tested compatible native-search transport and bounded fee reservation. Keep native server tools outside function dispatch; do not infer charges from text.

Bureau must not guess counts or claim an unsupported preset works. Any bounded implementation/fallback will name this finding and report remaining provider limitations.

Further official-source check, 18 October: Kimi's legacy `$web_search` retires on **20 October 2026**. Its current
migration notice recommends standalone first-party `/v1/tools/search`, `search_pro`, `fetch`; a new long-lived
integration should not silently ship the retiring built-in. Legacy fee is $0.005/call. Source:
https://platform.kimi.ai/docs/guide/use-web-search . This adds a vendor-lifecycle decision to the missing integration.
