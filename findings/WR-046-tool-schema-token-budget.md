# WR-046 — Measure and shrink tool-schema token cost

- **Package:** `@warlock.js/ai` 5.30.0 (`extractJsonSchema`, tools)
- **Classification:** feature request
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

Tool schemas are sent with every call and are often the largest fixed cost of an agent turn. There is no helper to measure that cost, and no compact schema mode (dropping descriptions on obvious fields, collapsing enums, trimming defaults).

## Request

- `ai.tools.measure(tools, { model }) → { tokens, perTool }`, exact via the provider's count API where available, estimated otherwise.
- `extractJsonSchema(schema, { compact: true })` and an agent option `toolSchemas: "full" | "compact"`.
