/** A detached Messages API body and the SDK endpoint and beta headers used to send it. */
export type AnthropicRequest<Streaming extends boolean = boolean> = {
  endpoint: "messages" | "beta.messages";
  body: Record<string, unknown> & { stream: Streaming };
  betas: string[];
};

export type AnthropicStreamingRequest = AnthropicRequest<true>;
export type AnthropicNonStreamingRequest = AnthropicRequest<false>;

/** Transport options are separate from the request body being audited. */
export type AnthropicRequestOptions = { signal?: AbortSignal };
