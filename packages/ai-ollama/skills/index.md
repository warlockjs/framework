---
description: "Provider adapter for local and self-hosted Ollama servers in Warlock AI applications. Exports `OllamaSDK` with model and provider configuration for the shared AI contracts. Use when connecting this provider, configuring host and headers, reasoning, embeddings and daemon errors, or diagnosing provider requests and usage. Read `setup-ollama` for construction and examples using an Ollama host. Not this package: agent loops, tools and workflows → @warlock.js/ai; HTTP and MCP tools → @warlock.js/ai-tools."
---

# @warlock.js/ai-ollama

This adapter supplies provider-backed models for `@warlock.js/ai`. Read `setup-ollama.md` to construct `OllamaSDK`, configure host and headers, reasoning, embeddings and daemon errors, and understand provider-specific behavior.

For agent composition, read the `run-ai-agent` topic of the `@warlock.js/ai` package. Keep provider configuration here and application orchestration in that package.
