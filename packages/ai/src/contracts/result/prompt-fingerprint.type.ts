/**
 * Hashes of the parts of a model request that decide whether a provider's
 * prompt cache can be reused. Only hashes are kept, never the text.
 * Recorded when `agent({ diagnostics: { cacheFingerprint: true } })` is set.
 */
export type PromptFingerprint = {
  /** Hash of the system message(s). */
  system: string;
  /** Hash of the serialized tool definitions, in the order sent. */
  tools: string;
  /**
   * Hash of the leading non-system messages: the messages the previous
   * trip already sent (all of them on the first trip). Equal across
   * trips while the conversation prefix is unchanged.
   */
  messagesPrefix: string;
};

/** A request segment that can break a cached prompt prefix. */
export type CacheMissSegment = "system" | "tools" | "messages" | "options";
