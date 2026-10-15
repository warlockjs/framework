import type { Usage } from "@warlock.js/ai";

/**
 * USD pricing for a text-to-video model. Video providers meter per
 * second of generated video (Sora / Veo / Kling); a token channel is
 * kept for the rare token-metered model. Per-second wins when both are
 * set. Folds into the same `Usage.cost` rollup as every other modality.
 *
 * @example
 * const pricing: VideoModelPricing = { perSecond: 0.1 };
 */
export type VideoModelPricing = {
  /** USD per second of generated video — per-second-metered models. */
  perSecond?: number;
  /** USD per 1M input tokens — token-metered models. */
  input?: number;
  /** USD per 1M output tokens — token-metered models. */
  output?: number;
};

/**
 * One generated video, normalized to a discriminated shape (mirrors
 * `GeneratedImage`). Providers return either a hosted URL (typically the
 * common case for video, which is large) or inlined base64 bytes.
 */
export type GeneratedVideo =
  | { type: "url"; url: string; mediaType?: string }
  | { type: "base64"; base64: string; mediaType: string };

/** Options for a single {@link VideoModelContract.generate} request. */
export type VideoOptions = {
  /** Requested clip length in seconds. */
  durationSeconds?: number;
  /** Aspect ratio (e.g. `"16:9"`, `"9:16"`). */
  aspectRatio?: string;
  /** Resolution hint (e.g. `"720p"`, `"1080p"`). */
  resolution?: string;
  /** Concepts to steer away from. */
  negativePrompt?: string;
  /** Cancellation handle. */
  signal?: AbortSignal;
  /** Provider-specific escape hatch — forwarded verbatim. */
  [key: string]: unknown;
};

/**
 * Raw result of a {@link VideoModelContract.generate} call. The adapter
 * hides the submit→poll lifecycle and resolves only when the video is
 * ready (or throws a typed `AIError`). The never-throws envelope is
 * added by `ai.video()`.
 */
export type VideoGenerationResponse = {
  video: GeneratedVideo;
  /** Token usage when the provider reports it; otherwise all-zero. */
  usage: Usage;
  /** Final clip duration in seconds — drives per-second cost. */
  durationSeconds?: number;
};

/**
 * Provider-neutral contract for a text-to-video model — the moving-image
 * sibling of `ImageModelContract`. Produced by an adapter's `video()`
 * factory and consumed by `ai.video()`. `generate()` encapsulates the
 * provider's async job (submit → poll → fetch result).
 */
export interface VideoModelContract {
  readonly name: string;
  readonly provider: string;
  readonly pricing?: VideoModelPricing;
  generate(prompt: string, options?: VideoOptions): Promise<VideoGenerationResponse>;
}

/** Configuration passed to an adapter's `video()` factory. */
export type VideoModelConfig = {
  name: string;
  pricing?: VideoModelPricing;
  [key: string]: unknown;
};
