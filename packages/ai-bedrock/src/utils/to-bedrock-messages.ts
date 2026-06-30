import { InvalidRequestError, type ContentPart, type Message } from "@warlock.js/ai";
import type {
  ContentBlock,
  ImageFormat,
  Message as BedrockMessage,
  SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Result of splitting a vendor-neutral `Message[]` for the Bedrock
 * Converse API: system prompts hoist to a separate `SystemContentBlock[]`
 * (Converse has no `"system"` role inside `messages`), and the
 * remaining turns map to Bedrock `Message[]`.
 */
export type BedrockMessages = {
  system: SystemContentBlock[] | undefined;
  messages: BedrockMessage[];
};

const MEDIA_TYPE_TO_FORMAT: Record<string, ImageFormat> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Convert vendor-neutral `Message[]` into Bedrock Converse's request
 * shape.
 *
 * Converse differs from the OpenAI Chat protocol in three ways this
 * function absorbs:
 *
 * 1. **No `system` role.** System messages become a separate
 *    `SystemContentBlock[]` (one `{ text }` block each).
 * 2. **Tool results are `user` turns.** A neutral `tool` message
 *    becomes a `user` message carrying a single `toolResult` block.
 * 3. **Tool calls are `toolUse` content blocks.** An assistant message
 *    with `toolCalls` becomes an `assistant` message: an optional
 *    leading `text` block followed by one `toolUse` block per call.
 *
 * @example
 * const { system, messages } = toBedrockMessages([
 *   { role: "system", content: "Be concise." },
 *   { role: "user", content: "Hi" },
 * ]);
 */
export function toBedrockMessages(messages: Message[]): BedrockMessages {
  const system: SystemContentBlock[] = [];
  const mapped: BedrockMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      system.push({ text: stringifyContent(message.content) });

      continue;
    }

    if (message.role === "tool") {
      mapped.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: message.toolCallId ?? "",
              content: [{ text: stringifyContent(message.content) }],
            },
          },
        ],
      });

      continue;
    }

    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      const blocks: ContentBlock[] = [];
      const text = stringifyContent(message.content);

      if (text) {
        blocks.push({ text });
      }

      for (const toolCall of message.toolCalls) {
        blocks.push({
          toolUse: {
            toolUseId: toolCall.id,
            name: toolCall.name,
            input: toolCall.input ?? {},
          },
        } as ContentBlock);
      }

      mapped.push({ role: "assistant", content: blocks });

      continue;
    }

    if (message.role === "user" && Array.isArray(message.content)) {
      mapped.push({
        role: "user",
        content: message.content.map(toBedrockContentBlock),
      });

      continue;
    }

    mapped.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: [{ text: stringifyContent(message.content) }],
    });
  }

  return {
    system: system.length > 0 ? system : undefined,
    messages: mapped,
  };
}

/**
 * Multipart content is only meaningful on user messages — for any other
 * role collapse a `ContentPart[]` to its concatenated text. Plain
 * strings pass through unchanged.
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
 * Map a resolved `ContentPart` to a Bedrock `ContentBlock`. Bedrock's
 * `ImageSource` only accepts raw bytes or an S3 location — there is no
 * remote-URL source. A neutral `{ url }` image therefore cannot be
 * sent and surfaces a typed `InvalidRequestError` upfront rather than
 * a downstream Bedrock validation fault. The agent has already
 * resolved attachments, so this never fetches or reads anything.
 */
function toBedrockContentBlock(part: ContentPart): ContentBlock {
  if (part.type === "text") {
    return { text: part.text };
  }

  if ("url" in part.source) {
    throw new InvalidRequestError(
      "Bedrock Converse does not support remote-URL sources; supply base64 bytes instead.",
    );
  }

  // PDF → Bedrock `document` content block (A2). Converse accepts a
  // document block with raw bytes; the agent gates this on the model's
  // `pdf` capability before it reaches here.
  if (part.type === "pdf") {
    return {
      document: {
        format: "pdf",
        name: "attachment",
        source: { bytes: Buffer.from(part.source.base64, "base64") },
      },
    } as unknown as ContentBlock;
  }

  // Bedrock Converse has no audio content block (capability stays false).
  if (part.type === "audio") {
    throw new InvalidRequestError(
      "Bedrock Converse does not support audio attachments.",
    );
  }

  const format = MEDIA_TYPE_TO_FORMAT[part.source.mediaType];

  if (!format) {
    throw new InvalidRequestError(
      `Unsupported image media type for Bedrock: "${part.source.mediaType}" (expected image/jpeg, image/png, image/gif, or image/webp).`,
    );
  }

  return {
    image: {
      format,
      source: { bytes: Buffer.from(part.source.base64, "base64") },
    },
  };
}
