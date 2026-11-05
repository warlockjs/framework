/** Media types an image part in a tool result may carry. */
export type ToolResultImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/**
 * One piece of a tool result that is more than JSON: text, or an inline
 * image the model should be able to look at.
 */
export type ToolResultPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { base64: string; mediaType: ToolResultImageMediaType } };

/**
 * The value a tool's `execute` returns to hand the model text and images.
 *
 * A return value is read as content parts only when it is an object with
 * exactly one key, `content`, holding a non-empty array in which every
 * element is a valid {@link ToolResultPart}. Any other value, including an
 * object that merely has a `content` key next to other keys, is serialised
 * as JSON exactly as before.
 *
 * @example
 * const screenshot = ai.tool({
 *   name: "screenshot",
 *   async execute() {
 *     return { content: [{ type: "image", source: { base64, mediaType: "image/png" } }] };
 *   },
 * });
 */
export type ToolResultContent = { content: ToolResultPart[] };
