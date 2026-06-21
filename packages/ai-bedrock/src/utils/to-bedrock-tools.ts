import { extractJsonSchema, type ToolConfig } from "@warlock.js/ai";
import type { Tool, ToolConfiguration, ToolInputSchema } from "@aws-sdk/client-bedrock-runtime";

/**
 * Convert vendor-neutral `ToolConfig[]` into Bedrock Converse's
 * `ToolConfiguration`. Each tool becomes a `toolSpec` with a JSON
 * `inputSchema`. Bedrock requires the schema root to be an object —
 * a non-object extraction degrades to a parameterless object schema
 * so registration never fails.
 *
 * Returns `undefined` when there are no tools so the caller can omit
 * `toolConfig` from the request entirely (Bedrock rejects an empty
 * `tools` array).
 *
 * @example
 * const toolConfig = toBedrockToolConfig([weatherTool]);
 * await client.send(new ConverseCommand({ modelId, messages, toolConfig }));
 */
export function toBedrockToolConfig(
  tools: ToolConfig<unknown, unknown>[] | undefined,
): ToolConfiguration | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return {
    tools: tools.map(
      (tool): Tool => ({
        toolSpec: {
          name: tool.name,
          description: tool.description,
          inputSchema: { json: toJsonSchema(tool.input) } as ToolInputSchema,
        },
      }),
    ),
  };
}

/**
 * Resolve a tool's input schema to a JSON-Schema object. Bedrock's
 * `ToolInputSchema.json` requires an object root; anything else (or a
 * failed extraction) degrades to a parameterless object so the tool
 * still registers.
 */
function toJsonSchema(input: ToolConfig<unknown, unknown>["input"]): Record<string, unknown> {
  const schema = extractJsonSchema(input);

  if (schema && schema.type === "object") {
    return schema;
  }

  return { type: "object" };
}
