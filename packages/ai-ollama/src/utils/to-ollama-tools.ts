import { extractJsonSchema, type ToolConfig } from "@warlock.js/ai";
import type { Tool } from "ollama";

/**
 * Convert vendor-neutral `ToolConfig[]` into Ollama's `tools` array.
 * Each tool becomes a `{ type: "function", function: { name,
 * description, parameters } }` entry. Non-object extractions degrade
 * to a parameterless object so registration never fails.
 *
 * Returns `undefined` when there are no tools so the caller can omit
 * `tools` from the request.
 *
 * @example
 * const tools = toOllamaTools([weatherTool]);
 * await ollama.chat({ model, messages, tools });
 */
export function toOllamaTools(
  tools: ToolConfig<unknown, unknown>[] | undefined,
): Tool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toParameters(tool.input),
    },
  }));
}

/**
 * Resolve a tool's input schema to a JSON-Schema object. Ollama wants
 * an object root for function parameters; anything else (or a failed
 * extraction) degrades to a parameterless object.
 */
function toParameters(input: ToolConfig<unknown, unknown>["input"]): Tool["function"]["parameters"] {
  const schema = extractJsonSchema(input);

  if (schema && schema.type === "object") {
    return schema as Tool["function"]["parameters"];
  }

  return { type: "object" } as Tool["function"]["parameters"];
}
