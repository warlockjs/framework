# WR-020: The MCP client hides each remote tool's input schema from provider adapters (fixed in 5.34.1)

Date: 2026-10-19 · Packages: @warlock.js/ai-tools 5.33.0 (`mcp` client), @warlock.js/ai 5.33.0 (`extractJsonSchema`)
· From: Bureau, a live trace where a one-line "Hi" took three model calls

## What happens

`ai.mcp(server).tools()` adapts each descriptor with `jsonSchemaToStandard(descriptor.inputSchema)`. The wrapper it
returns has only `~standard.validate` (Ajv). It has no `~standard.jsonSchema.input()` and no top-level `jsonSchema`,
so `extractJsonSchema(tool.input)` returns `undefined`. Every provider adapter then falls back to a parameterless
schema; for example `toAnthropicTools` sends `input_schema: { type: "object" }`.

The model therefore sees MCP tools with no argument names at all. In Bureau's trace it called `bureau_post_message`
with `{"input":{"content":"…","final":true,"notify":false}}`. The tool expects a flat `{ text, final, notify }`, so
Ajv refused the call ("must have required property 'text'; must NOT have additional properties"), and the model
retried on a second call.

Validation is correct. Only the schema the provider is shown is lost.

## Reproduce

```ts
import { extractJsonSchema } from "@warlock.js/ai";
import { jsonSchemaToStandard } from "@warlock.js/ai-tools";

const input = jsonSchemaToStandard({
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
});
extractJsonSchema(input); // undefined, so adapters advertise { type: "object" }
```

## Request (target 5.34.x)

- `jsonSchemaToStandard(schema)` exposes the schema it wraps:
  `~standard.jsonSchema = { input: () => schema, output: () => schema }`, the Standard JSON Schema V1 path
  `extractJsonSchema` already reads. Descriptors without an `inputSchema` can keep the accept-all wrapper, with
  `{ type: "object", properties: {} }`.
- Add a spec that an adapted MCP tool's `extractJsonSchema(tool.input)` deep-equals the server's `inputSchema`.

## Bureau's workaround (remove once fixed)

`src/app/engines/wjs/runner/parts/advertise-mcp-tool-schemas.ts` reads `tools/list` once more through the exported
`createJsonRpcClient`. It then attaches each descriptor's `inputSchema` as `~standard.jsonSchema` on the adapted
contract, and validation is untouched. A spec asserts that the provider-facing schema for `bureau_post_message`
equals Bureau's canonical one.
