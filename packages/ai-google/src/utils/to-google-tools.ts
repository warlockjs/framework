import { extractJsonSchema, type ToolConfig } from "@warlock.js/ai";
import type { Tool } from "@google/genai";

/**
 * Convert vendor-neutral `ToolConfig[]` into Gemini's `tools` array —
 * a single `Tool` carrying one `functionDeclarations` entry per tool.
 *
 * The input schema is forwarded via `parametersJsonSchema` (raw JSON
 * Schema, mutually exclusive with Gemini's typed `parameters`).
 * Non-object extractions degrade to a parameterless object so
 * registration never fails.
 *
 * Returns `undefined` when there are no tools so the caller can omit
 * `config.tools` entirely.
 *
 * @example
 * const tools = toGoogleTools([weatherTool]);
 * await ai.models.generateContent({ model, contents, config: { tools } });
 */
export function toGoogleTools(
  tools: ToolConfig<unknown, unknown>[] | undefined,
): Tool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: toJsonSchema(tool.input),
      })),
    },
  ];
}

/**
 * Resolve a tool's input schema to a JSON-Schema object. Gemini wants
 * an object root for function parameters; anything else (or a failed
 * extraction) degrades to a parameterless object.
 */
function toJsonSchema(input: ToolConfig<unknown, unknown>["input"]): Record<string, unknown> {
  const schema = extractJsonSchema(input);

  if (schema && schema.type === "object") {
    return schema;
  }

  return { type: "object" };
}
