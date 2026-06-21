import { InvalidRequestError, type ContentPart, type Message } from "@warlock.js/ai";
import type { Message as OllamaMessage } from "ollama";

/**
 * Convert vendor-neutral `Message[]` into the Ollama chat message
 * shape.
 *
 * Unlike Anthropic / Gemini / Bedrock, Ollama keeps a first-class
 * `system` role inside `messages`, so there is no system-prompt
 * hoisting — roles pass straight through. The Ollama specifics this
 * absorbs:
 *
 * 1. **Tool calls.** An assistant message with `toolCalls` becomes an
 *    `assistant` message whose `tool_calls` is the Ollama
 *    `{ function: { name, arguments } }` shape (Ollama has no tool-call
 *    id — see `OllamaModel`/decisions for the synthesized-id note).
 * 2. **Tool results.** A neutral `tool` message becomes a `tool`
 *    message with `tool_name` set from `toolCallId` (Ollama matches a
 *    result to its call by tool name).
 * 3. **Images.** Multipart user content collapses to a single
 *    `content` string plus an `images` array of base64 strings.
 *
 * @example
 * const messages = toOllamaMessages([
 *   { role: "system", content: "Be concise." },
 *   { role: "user", content: "Hi" },
 * ]);
 */
export function toOllamaMessages(messages: Message[]): OllamaMessage[] {
  return messages.map((message): OllamaMessage => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: stringifyContent(message.content),
        tool_name: message.toolCallId ?? "",
      };
    }

    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: stringifyContent(message.content),
        tool_calls: message.toolCalls.map((toolCall) => ({
          function: {
            name: toolCall.name,
            arguments: (toolCall.input ?? {}) as Record<string, unknown>,
          },
        })),
      };
    }

    if (message.role === "user" && Array.isArray(message.content)) {
      return toMultipartMessage(message.content);
    }

    return { role: message.role, content: stringifyContent(message.content) };
  });
}

/**
 * Collapse a `ContentPart[]` user message into Ollama's
 * single-string-content + base64-`images` shape. Ollama cannot fetch
 * remote URLs, so a `{ url }` image surfaces a typed
 * `InvalidRequestError` upfront (consistent with the Bedrock/Gemini
 * adapters). The agent has already resolved attachments — nothing is
 * fetched here.
 */
function toMultipartMessage(parts: ContentPart[]): OllamaMessage {
  const textChunks: string[] = [];
  const images: string[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      textChunks.push(part.text);

      continue;
    }

    if ("url" in part.source) {
      throw new InvalidRequestError(
        "Ollama does not fetch remote-URL images; supply base64 image bytes instead.",
      );
    }

    images.push(part.source.base64);
  }

  return {
    role: "user",
    content: textChunks.join(""),
    ...(images.length > 0 ? { images } : {}),
  };
}

/**
 * Multipart content on a non-user role collapses to concatenated text;
 * plain strings pass through unchanged.
 */
function stringifyContent(content: string | ContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}
