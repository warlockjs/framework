import type { StreamChunkOptions } from "@warlock.js/ai";

/** A detached Messages API body and the SDK endpoint and beta headers used to send it. */
export type AnthropicRequest<Streaming extends boolean = boolean> = {
  endpoint: "messages" | "beta.messages";
  body: Record<string, unknown> & { stream: Streaming };
  betas: string[];
};

export type AnthropicStreamingRequest = AnthropicRequest<true>;
export type AnthropicNonStreamingRequest = AnthropicRequest<false>;

/**
 * Transport options are separate from the request body being audited.
 * `streamChunks` picks the optional stream chunks (`reasoning`,
 * `tool-args`, `usage`) a streaming send yields; it never touches the body.
 */
export type AnthropicRequestOptions = { signal?: AbortSignal; streamChunks?: StreamChunkOptions };
