/**
 * What a model is for, as far as the provider's listing says. Providers that
 * report modalities or supported methods give an exact answer; the others are
 * classified from the model id (`inferModelKind`), which is a best effort.
 */
export type ModelKind = "chat" | "embedding" | "image" | "audio" | "moderation" | "other";

/**
 * One model reported by a provider's live model listing, in the shape every
 * first-party adapter returns from `SDKAdapterContract.models()`.
 *
 * Only `id`, `label`, `provider` and `kind` are always present. The other
 * fields are filled when the provider's listing carries them and left out
 * otherwise, never guessed.
 */
export type ModelInfo = {
  /** The id to pass as `name` to `sdk.model({ name })`, without any `models/` prefix. */
  id: string;
  /** Human-readable name. The id when the provider has no display name. */
  label: string;
  /** The SDK's provider label (`"openai"`, `"anthropic"`, or a relabelled gateway). */
  provider: string;
  /** What the model is for. See {@link ModelKind}. */
  kind: ModelKind;
  /** Creation or release time in Unix seconds, when the provider reports one. */
  created?: number;
  /** Maximum input tokens, when reported. */
  contextWindow?: number;
  /** Maximum output tokens, when reported. */
  maxOutputTokens?: number;
  /** Provider description, when reported. */
  description?: string;
};

/** Options for `SDKAdapterContract.models()`. */
export type ListModelsOptions = {
  /** Cancels the listing request (including any further pages). */
  signal?: AbortSignal;
};
