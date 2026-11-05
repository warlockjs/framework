import type { ContentPart } from "../contracts/content-part.type";
import type { ToolResultContent, ToolResultPart } from "../contracts/tool-result-content.type";

const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Text an adapter sends in place of an image part its provider cannot read in a tool result. */
export const TOOL_RESULT_IMAGE_PLACEHOLDER =
  "[image omitted: provider cannot read images in tool results]";

function isToolResultPart(value: unknown): value is ToolResultPart {
  if (typeof value !== "object" || value === null) return false;

  const part = value as Record<string, unknown>;

  if (part.type === "text") return typeof part.text === "string";

  if (part.type !== "image") return false;

  const source = part.source as Record<string, unknown> | null | undefined;

  return (
    typeof source === "object" &&
    source !== null &&
    typeof source.base64 === "string" &&
    typeof source.mediaType === "string" &&
    IMAGE_MEDIA_TYPES.has(source.mediaType)
  );
}

/**
 * True when a tool's return value is content parts rather than a plain
 * value: an object whose only key is `content`, a non-empty array of valid
 * text and image parts.
 */
export function isToolResultContent(value: unknown): value is ToolResultContent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const keys = Object.keys(value);

  if (keys.length !== 1 || keys[0] !== "content") return false;

  const content = (value as { content: unknown }).content;

  return Array.isArray(content) && content.length > 0 && content.every(isToolResultPart);
}

/**
 * Flatten a tool message's content to text for a provider that cannot read
 * images in tool results: text parts are joined, each image becomes
 * {@link TOOL_RESULT_IMAGE_PLACEHOLDER}. A string passes through.
 */
export function toolResultText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;

  const hasImage = content.some((part) => part.type === "image");

  return content
    .map((part) => {
      if (part.type === "text") return part.text;

      return part.type === "image" ? TOOL_RESULT_IMAGE_PLACEHOLDER : "";
    })
    .filter((text) => text !== "")
    .join(hasImage ? "\n" : "");
}
