---
title: "Lint tool schemas"
description: ai.tool() checks its JSON Schema against OpenAI strict, Anthropic and Google at definition time, warns once per tool in development, and reports the token cost of every definition.
sidebar:
  order: 7
  label: "Lint tool schemas"
---

A tool definition is sent to the model on every call: its name, description and JSON Schema. Providers differ in what they accept, and a schema that works on one can be rejected, silently changed or just expensive on another. `ai.tool()` checks the definition when you create it, and the same check is available as an API and a CLI command.

## The development warning

In development, `ai.tool()` logs one warning per tool definition when a check finds something. Nothing is logged under a test runner or in production, and the tool you get back is unchanged.

```text
warn ai.tool schema.lint tool "save_facts" (~410 tokens per call) has 2 schema findings
  warning [openai-strict, anthropic, google] properties.note: "note" is optional in the schema but is sent as required and nullable, so the model must always fill it ...
  warning [openai-strict, anthropic, google]: Estimated 410 tokens per call (budget 500) ...
```

Turn it off for one tool, or tune it:

```ts
ai.tool({ name: "save_facts", description, input, execute, lint: false });
ai.tool({ name: "save_facts", description, input, execute, lint: { targets: ["anthropic"], warnAboveTokens: 300 } });

// For the whole app:
ai.config({ toolLint: false });
ai.config({ toolLint: { targets: ["openai-strict"], maxDescriptionChars: 600 } });
```

A tool's own `lint` wins over `ai.config({ toolLint })`.

## What is checked

The schema checked is the one the provider adapters send: the shared `extractJsonSchema` output, which for Seal schemas is the `openai-strict` shape.

| Code                                  | Severity | Meaning                                                                                                                                                                          |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optional-forced-required`            | warning  | A field declared optional is sent as required and nullable (compared with the `draft-2020-12` extraction), so the model must fill it on every call, with `null` when it has nothing. |
| `optional-not-required`               | error    | A property is not in `required`; OpenAI strict mode rejects the tool.                                                                                                            |
| `missing-additional-properties-false` | error    | An object does not set `additionalProperties: false`; OpenAI strict mode rejects it.                                                                                              |
| `unsupported-keyword`                 | warning  | A keyword the provider rejects or ignores. OpenAI strict: `allOf`, `oneOf` (use `anyOf`), `not`, `if`/`then`/`else`, `dependentRequired`, `dependentSchemas`, `patternProperties`, `propertyNames`, `unevaluatedProperties`. Google: the same list without `oneOf`. Anthropic accepts the schema as written. |
| `root-not-object`                     | error    | The input is not an object schema, so the adapters send the tool with no parameters.                                                                                              |
| `invalid-name`                        | error    | The name is outside what the provider accepts (`[a-zA-Z0-9_-]{1,64}` for OpenAI and Anthropic; letters, digits, `_ . : -`, starting with a letter or `_`, for Google).            |
| `oversized-description`               | warning  | A tool description over 1024 characters, or a property description over 512. Both are sent on every call.                                                                          |
| `heavy-definition`                    | warning  | The estimated token cost is above the budget (default 500).                                                                                                                      |

Findings that apply to several providers are merged into one entry listing its `targets`.

## `describeToolSchema()`

```ts
import { ai } from "@warlock.js/ai";

const report = ai.tools.describe(saveFacts);
// {
//   name: "save_facts",
//   tokens: 410,           // estimated input tokens this definition adds to every call
//   descriptionChars: 812,
//   schemaHash: "9f3c1a2b7d4e5f60",
//   targets: ["openai-strict", "anthropic", "google"],
//   issues: [{ code, severity, targets, path, message }],
//   ok: true,              // false when any issue is an "error"
// }

const { tools, tokens, issueCount } = ai.tools.describeAll(agentTools);
```

Both are also exported standalone as `describeToolSchema` and `describeToolSchemas`. Options: `targets`, `maxDescriptionChars`, `maxPropertyDescriptionChars`, `warnAboveTokens` and `charsPerToken`.

### The token number

`tokens` is an **estimate**: the definition's name, description and JSON Schema at four characters per token (`charsPerToken`; lower it to 3 for dense JSON). It is the same heuristic as `estimateInputTokens`, offline and instant. It can be off by tens of percent. For an exact count with a model that has a count endpoint (Anthropic, Google, Bedrock, OpenAI Responses), use `ai.tools.measure(tools, { model })`, which counts each tool's marginal cost natively.

`schemaHash` covers the name, description and schema as sent. Equal hashes mean identical definitions, which is how agent traces tell whether two runs offered the same tools.

## From the terminal

```sh
warlock ai tools --tools ./src/ai/tools.ts
warlock ai tools --tools ./src/ai/tools.ts --targets anthropic,google --warn-above 300 --fail
```

`--fail` exits with code 1 when a tool has an error-level finding, so CI can gate on it. See [AI tools in the CLI](/v/latest/core/cli/ai/).

## Related

- [Define tools](/v/latest/ai/tools/define-tools/) — the `ai.tool()` factory.
- [Cost and efficiency](/v/latest/ai/best-practices/cost-and-efficiency/) — `toolSchemas: "compact"` and measuring a call.
- [Agent traces](/v/latest/ai/observability/agent-trace/) — the tools offered on every turn, with schema hashes.
