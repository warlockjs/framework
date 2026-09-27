import type { ContentBlock } from "@aws-sdk/client-bedrock-runtime";

/**
 * JSON-safe representation of a Bedrock Converse reasoning block retained in
 * tool-call provider metadata. Binary redacted reasoning is base64 encoded so
 * it survives message-history persistence unchanged.
 */
export type BedrockReasoningBlock =
  | { type: "reasoning"; text: string; signature?: string }
  | { type: "redacted"; data: string };

/** Convert a Converse reasoning content block to persistence-safe metadata. */
export function toReasoningMetadata(block: ContentBlock): BedrockReasoningBlock | undefined {
  const reasoning = block.reasoningContent;

  if (!reasoning) {
    return undefined;
  }

  if (reasoning.reasoningText) {
    const { text, signature } = reasoning.reasoningText;

    if (typeof text !== "string") {
      return undefined;
    }

    return { type: "reasoning", text, ...(typeof signature === "string" ? { signature } : {}) };
  }

  if (reasoning.redactedContent instanceof Uint8Array) {
    return { type: "redacted", data: Buffer.from(reasoning.redactedContent).toString("base64") };
  }

  return undefined;
}

/** Restore one persistence-safe metadata entry to a Converse reasoning block. */
export function fromReasoningMetadata(value: unknown): ContentBlock | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  if (value.type === "reasoning" && typeof value.text === "string") {
    return {
      reasoningContent: {
        reasoningText: {
          text: value.text,
          ...(typeof value.signature === "string" ? { signature: value.signature } : {}),
        },
      },
    };
  }

  if (value.type === "redacted" && typeof value.data === "string" && isBase64(value.data)) {
    return { reasoningContent: { redactedContent: new Uint8Array(Buffer.from(value.data, "base64")) } };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Require canonical base64, avoiding Buffer's permissive decoding of garbage. */
function isBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }

  return Buffer.from(value, "base64").toString("base64") === value;
}
