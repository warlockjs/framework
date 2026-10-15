import type { ContentPart, Message, ModelToolCallRequest } from "@warlock.js/ai";
import type Anthropic from "@anthropic-ai/sdk";
import { fromProviderBlocks } from "./provider-blocks";

/**
 * Result of splitting a vendor-neutral `Message[]` for the Anthropic
 * Messages API: the system prompt is hoisted to a top-level `system`
 * string (Anthropic has no `"system"` role inside `messages`), and the
 * remaining turns are mapped to `MessageParam[]`.
 */
export type AnthropicMessages = {
  system: string | undefined;
  messages: Anthropic.MessageParam[];
};

const ANTHROPIC_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

type AnthropicImageMediaType = (typeof ANTHROPIC_IMAGE_MEDIA_TYPES)[number];

/**
 * Convert vendor-neutral `Message[]` into Anthropic's request shape.
 *
 * Anthropic differs from the OpenAI Chat protocol in three ways this
 * function absorbs:
 *
 * 1. **No `system` role.** System messages are concatenated (newline-
 *    separated) and returned separately as the top-level `system`
 *    parameter.
 * 2. **Tool results are `user` turns.** A neutral `tool` message becomes
 *    a `tool_result` block keyed by `tool_use_id`. Consecutive tool
 *    messages (the results of one parallel tool-use turn) are grouped
 *    into a single `user` message, as Anthropic expects — splitting them
 *    across messages teaches the model to stop calling tools in parallel.
 * 3. **Tool calls are `tool_use` content blocks.** An assistant message
 *    carrying `toolCalls` becomes an `assistant` message whose content
 *    is an optional leading `text` block followed by one `tool_use`
 *    block per call.
 *
 * An assistant message that carries Anthropic `blocks` (thinking,
 * redacted thinking, compaction, server-tool blocks — see
 * `ProviderContentBlock`) is replayed verbatim from those blocks, which
 * keeps signed thinking and compaction state valid. Blocks from another
 * provider, or blocks whose `tool_use` ids no longer match `toolCalls`,
 * are ignored and the turn is rebuilt from `content` + `toolCalls`.
 *
 * Other consecutive same-role turns are left as-is — the Messages API
 * merges them server-side.
 *
 * @example
 * const { system, messages } = toAnthropicMessages([
 *   { role: "system", content: "Be concise." },
 *   { role: "user", content: "Hi" },
 * ]);
 * // system === "Be concise."
 * // messages === [{ role: "user", content: "Hi" }]
 */
export function toAnthropicMessages(messages: Message[]): AnthropicMessages {
  const systemParts: string[] = [];
  const mapped: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(stringifyContent(message.content));

      continue;
    }

    if (message.role === "tool") {
      const toolResult: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: message.toolCallId ?? "",
        content: stringifyContent(message.content),
      };
      const previous = mapped[mapped.length - 1];

      if (previous && previous.role === "user" && isToolResultTurn(previous)) {
        previous.content.push(toolResult);
      } else {
        mapped.push({ role: "user", content: [toolResult] });
      }

      continue;
    }

    if (message.role === "assistant") {
      const replayed = fromProviderBlocks(message.blocks, message.toolCalls);

      if (replayed) {
        mapped.push({ role: "assistant", content: replayed });

        continue;
      }
    }

    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      const blocks: Anthropic.ContentBlockParam[] = extractThinkingBlocks(message.toolCalls);
      const text = stringifyContent(message.content);

      if (text) {
        blocks.push({ type: "text", text });
      }

      for (const toolCall of message.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input ?? {},
        });
      }

      mapped.push({ role: "assistant", content: blocks });

      continue;
    }

    if (message.role === "user" && Array.isArray(message.content)) {
      mapped.push({
        role: "user",
        content: message.content.map(toAnthropicContentBlock),
      });

      continue;
    }

    mapped.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: stringifyContent(message.content),
    });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: mapped,
  };
}

/**
 * Recover signed extended-thinking blocks stored by this adapter on a tool
 * request. Anthropic requires these blocks to be replayed before the
 * assistant's text and tool uses on the following request.
 */
function extractThinkingBlocks(toolCalls: ModelToolCallRequest[]): Anthropic.ContentBlockParam[] {
  for (const toolCall of toolCalls) {
    const anthropic = toolCall.providerMetadata?.anthropic;

    if (!isRecord(anthropic) || !Array.isArray(anthropic.thinkingBlocks)) {
      continue;
    }

    return anthropic.thinkingBlocks.flatMap(toAnthropicThinkingBlock);
  }

  return [];
}

function toAnthropicThinkingBlock(block: unknown): Anthropic.ContentBlockParam[] {
  if (!isRecord(block) || typeof block.type !== "string") {
    return [];
  }

  if (
    block.type === "thinking" &&
    typeof block.thinking === "string" &&
    typeof block.signature === "string"
  ) {
    return [{ type: "thinking", thinking: block.thinking, signature: block.signature }];
  }

  if (block.type === "redacted_thinking" && typeof block.data === "string") {
    return [{ type: "redacted_thinking", data: block.data }];
  }

  return [];
}

/**
 * A `user` turn this function built from tool results — its content is a
 * non-empty array made only of `tool_result` blocks. Later tool results
 * of the same tool-use turn are appended to it.
 */
function isToolResultTurn(
  message: Anthropic.MessageParam,
): message is Anthropic.MessageParam & { content: Anthropic.ContentBlockParam[] } {
  return (
    Array.isArray(message.content) &&
    message.content.length > 0 &&
    message.content.every((block) => block.type === "tool_result")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Multipart content is only meaningful on user messages — for any other
 * role collapse a `ContentPart[]` to its concatenated text so the wire
 * format stays valid. Plain strings pass through unchanged.
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

/**
 * Map a single resolved `ContentPart` to an Anthropic content block.
 * Text passes straight through; images become an `image` block with a
 * `url` source (remote) or a `base64` source (inlined bytes). The
 * agent has already resolved every attachment before it reaches here,
 * so this never reads files or fetches URLs.
 */
function toAnthropicContentBlock(part: ContentPart): Anthropic.ContentBlockParam {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }

  // PDF → Anthropic `document` block (A2). The Messages API accepts a
  // url or base64 `application/pdf` source on PDF-capable Claude models.
  if (part.type === "pdf") {
    const source =
      "url" in part.source
        ? { type: "url", url: part.source.url }
        : { type: "base64", media_type: "application/pdf", data: part.source.base64 };
    return { type: "document", source } as unknown as Anthropic.ContentBlockParam;
  }

  // Anthropic has no audio content block; the agent's capability gate
  // normally prevents this, but stay loud rather than mis-map it.
  if (part.type === "audio") {
    throw new Error("Anthropic adapter: audio attachments are not supported");
  }

  if ("url" in part.source) {
    return { type: "image", source: { type: "url", url: part.source.url } };
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: part.source.mediaType as AnthropicImageMediaType,
      data: part.source.base64,
    },
  };
}
