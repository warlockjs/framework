---
description: "Provider adapter for Google Gemini API and Vertex AI in Warlock AI applications. Exports `GoogleSDK` with model and provider configuration for the shared AI contracts. Use when connecting this provider, configuring API keys or Vertex project settings, reasoning and embeddings, or diagnosing provider requests and usage. Read `setup-google` for construction and examples using GOOGLE_API_KEY or Vertex credentials. Not this package: agent loops, tools and workflows → @warlock.js/ai; HTTP and MCP tools → @warlock.js/ai-tools."
---

# @warlock.js/ai-google

This adapter supplies provider-backed models for `@warlock.js/ai`. Read `setup-google.md` to construct `GoogleSDK`, configure API keys or Vertex project settings, reasoning and embeddings, and understand provider-specific behavior.

For agent composition, read the `run-ai-agent` topic of the `@warlock.js/ai` package. Keep provider configuration here and application orchestration in that package.
