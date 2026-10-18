---
title: AI measurement
sidebar:
  label: AI measure
description: Measure prompt, catalogue and tool-schema input tokens and projected USD from the terminal.
---

```sh
warlock ai measure --model <id> [--tools <module>] [--system <file>] [--skills <dir>] [--json]
```

This built-in command loads `@warlock.js/ai` lazily. Install AI and the provider adapter in the project where you run it. No `cli.commands` registration is needed. It loads environment files without bootstrapping app modules or connectors. Native counting may send the supplied input to the provider's count endpoint; no response is generated and no tool is executed. Imported modules run their own top-level code, so use modules intended for measurement.

| Option                    | Meaning                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--model <id>`            | Required model ID. An unqualified ID uses OpenAI Responses. Explicit prefixes: `openai:<id>`, `anthropic:<id>`, `google:<id>`.                      |
| `--model-module <module>` | Use an exported configured model or `resolveModel(id)` instead of the built-in provider factory.                                                    |
| `--tools <module>`        | Import a named `tools` array or default-exported array of tool configs / `ai.tool()` results. Raw executable primitives must first use `.asTool()`. |
| `--system <file>`         | Read resolved system text as UTF-8.                                                                                                                 |
| `--skills <dir>`          | Read catalogue metadata from direct `<dir>/<skill>/SKILL.md` folders; exclude bodies and automatic skill tools. A missing directory is an error.    |
| `--json`                  | Emit one JSON report to stdout; incidental console progress goes to stderr.                                                                         |

Paths and module specifiers resolve from the current directory. Use `./` for relative module paths. Built-in providers read `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`, respectively. These factory signatures follow the first-party adapters' `src/sdk.ts` and `src/config.type.ts`; OpenAI selects `api: "responses"` because that adapter exposes `countTokens`.

```sh
warlock ai measure --model "anthropic:$MODEL_ID" --system ./system.md
warlock ai measure --model "$MODEL_ID" --model-module ./measure-model.ts --tools ./measure-tools.ts --json
```

A configured module supports any provider implementing `ModelContract`, custom endpoints, and negotiated prices. For example:

```ts title="measure-model.ts"
import { OpenAISDK } from "@warlock.js/ai-openai";

const sdk = new OpenAISDK({}); // Uses the SDK's environment configuration.
export function resolveModel(name: string) {
  return sdk.model({ name, api: "responses" });
}
```

Or export an already configured model as `model` or `default`. Set its `pricing` when constructing it if the adapter has no built-in price for that model. The command does not look up or invent prices.

```ts title="measure-tools.ts"
import { ai } from "@warlock.js/ai";

export const tools = [
  ai.tool({
    name: "help",
    description: "Return a link to the help centre",
    execute: async () => "https://example.com/help",
  }),
];
```

The output has `parts.messages`, `parts.system`, `parts.skills`, `parts.tools`, and `total`. Each includes `tokens`, `source` (`native` or `estimate`), and `costUSD` when priced. Unknown prices display as `unknown` in the table and omit `costUSD` in JSON. The CLI uses a user message containing `.` and reports `probe: true`; its framing belongs to `parts.messages`.

USD is projected **uncached input per call**, excluding output, cache adjustments and hosted-tool fees. The entire report falls back to labelled estimates if a native endpoint explicitly cannot count the request shape. Provider errors fail the command. See [measure a call](/v/latest/ai/recipes/measure-call/) for attribution, comparison semantics, and representative-message measurements through the API.
