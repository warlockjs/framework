---
description: "Provider adapter for OpenAI and compatible gateways including Azure and OpenRouter in Warlock AI applications. Exports `OpenAISDK` with model and provider configuration for the shared AI contracts. Use when connecting this provider, configuring baseURL, reasoning, prompt caching, embeddings and image models, or diagnosing provider requests and usage. Read `setup-openai` for construction and examples using OPENAI_API_KEY. Not this package: agent loops, tools and workflows → @warlock.js/ai; HTTP and MCP tools → @warlock.js/ai-tools."
---

# @warlock.js/ai-openai

This adapter supplies provider-backed models for `@warlock.js/ai`. Read `setup-openai.md` to construct `OpenAISDK`, configure baseURL, reasoning, prompt caching, embeddings and image models, and understand provider-specific behavior.

For agent composition, read the `run-ai-agent` topic of the `@warlock.js/ai` package. Keep provider configuration here and application orchestration in that package.
