---
description: "Provider adapter for AWS Bedrock Converse API and Titan embeddings in Warlock AI applications. Exports `BedrockSDK` with model and provider configuration for the shared AI contracts. Use when connecting this provider, configuring region, the AWS credential chain, model capabilities and embeddings, or diagnosing provider requests and usage. Read `setup-bedrock` for construction and examples using AWS credentials. Not this package: agent loops, tools and workflows → @warlock.js/ai; HTTP and MCP tools → @warlock.js/ai-tools."
---

# @warlock.js/ai-bedrock

This adapter supplies provider-backed models for `@warlock.js/ai`. Read `setup-bedrock.md` to construct `BedrockSDK`, configure region, the AWS credential chain, model capabilities and embeddings, and understand provider-specific behavior.

For agent composition, read the `run-ai-agent` topic of the `@warlock.js/ai` package. Keep provider configuration here and application orchestration in that package.
