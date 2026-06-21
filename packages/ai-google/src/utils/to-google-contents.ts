import { InvalidRequestError, safeJsonParse, type ContentPart, type Message } from "@warlock.js/ai";
import type { Content, Part } from "@google/genai";

/**
 * Result of splitting a vendor-neutral `Message[]` for Gemini's
 * `generateContent`: the system prompt is hoisted to a separate
 * `systemInstruction` string (Gemini has no `"system"` role — content
 * roles must be `"user"` or `"model"`), and the remaining turns map to
 * `Content[]`.
 */
export type GoogleContents = {
  systemInstruction: string | undefined;
  contents: Content[];
};

/**
 * Convert vendor-neutral `Message[]` into Gemini's request shape.
 *
 * Gemini specifics this function absorbs:
 *
 * 1. **No `system` role.** System messages concatenate into the
 *    separate `systemInstruction` config field.
 * 2. **Role names differ.** Neutral `assistant` → Gemini `"model"`;
 *    `user` stays `"user"`.
 * 3. **Tool results are `user` turns.** A neutral `tool` message
 *    becomes a `"user"` content with a single `functionResponse` part.
 * 4. **Tool calls are `functionCall` parts.** An assistant message
 *    with `toolCalls` becomes a `"model"` content: an optional leading
 *    `text` part followed by one `functionCall` part per call.
 *
 * @example
 * const { systemInstruction, contents } = toGoogleContents([
 *   { role: "system", content: "Be concise." },
 *   { role: "user", content: "Hi" },
 * ]);
 */
export function toGoogleContents(messages: Message[]): GoogleContents {
  const systemParts: string[] = [];
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(stringifyContent(message.content));

      continue;
    }

    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            // Gemini matches a `functionResponse` to its `functionCall`
            // by `name` (the Developer API has no call ids). `name` is
            // the neutral `toolCallId`, which `GoogleModel` set to the
            // function name. The wire `id` is intentionally omitted —
            // an empty/synthetic id is rejected as an invalid argument.
            functionResponse: {
              name: message.toolCallId ?? "",
              response: toResponseObject(stringifyContent(message.content)),
            },
          },
        ],
      });

      continue;
    }

    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      const parts: Part[] = [];
      const text = stringifyContent(message.content);

      if (text) {
        parts.push({ text });
      }

      for (const toolCall of message.toolCalls) {
        // Replay the opaque `thoughtSignature` Gemini attached to this
        // function call on the original turn. Thinking models reject
        // the follow-up request with a 400 if the signature is missing
        // from the echoed `functionCall` part. Captured by
        // `GoogleModel.partToToolCall` into `providerMetadata`.
        const thoughtSignature = toolCall.providerMetadata?.thoughtSignature;

        parts.push({
          ...(typeof thoughtSignature === "string" ? { thoughtSignature } : {}),
          // `id` omitted deliberately — Gemini Developer API function
          // calls have no ids; echoing an empty/synthetic one is
          // rejected as an invalid argument. Matched by `name`.
          functionCall: {
            name: toolCall.name,
            args: (toolCall.input ?? {}) as Record<string, unknown>,
          },
        });
      }

      contents.push({ role: "model", parts });

      continue;
    }

    if (message.role === "user" && Array.isArray(message.content)) {
      contents.push({ role: "user", parts: message.content.map(toGooglePart) });

      continue;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: stringifyContent(message.content) }],
    });
  }

  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    contents,
  };
}

/**
 * Multipart content is only meaningful on user messages — for any
 * other role collapse a `ContentPart[]` to concatenated text. Plain
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
 * Gemini's `functionResponse.response` must be a JSON object. Tool
 * results arrive as a string (usually stringified JSON) — parse it
 * when it is a JSON object, otherwise wrap the raw string under a
 * `result` key so the model always receives a well-formed object.
 */
function toResponseObject(raw: string): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(raw, undefined);

  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  return { result: raw };
}

/**
 * Map a resolved `ContentPart` to a Gemini `Part`. Images are sent as
 * inline base64 (`inlineData`). Gemini's `generateContent` does not
 * fetch arbitrary remote URLs (only Files API / GCS URIs via
 * `fileData`), so a neutral `{ url }` image surfaces a typed
 * `InvalidRequestError` upfront rather than a downstream Gemini fault.
 * The agent resolves attachments before this point, so nothing is
 * read or fetched here.
 */
function toGooglePart(part: ContentPart): Part {
  if (part.type === "text") {
    return { text: part.text };
  }

  if ("url" in part.source) {
    throw new InvalidRequestError(
      "Gemini generateContent does not fetch remote-URL images; supply base64 image bytes instead.",
    );
  }

  return {
    inlineData: { mimeType: part.source.mediaType, data: part.source.base64 },
  };
}
