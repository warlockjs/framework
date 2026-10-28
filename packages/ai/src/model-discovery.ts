import type { ModelKind } from "./contracts/model-info.type";

/**
 * Classify a model by its id, for providers whose listing carries no
 * modality or method information. Best effort: used by the adapters only
 * when the provider gives nothing better, so treat `"other"` as "unknown or
 * not a conversational model".
 *
 * @example
 * inferModelKind("text-embedding-3-small"); // "embedding"
 * inferModelKind("gpt-image-1");            // "image"
 * inferModelKind("gpt-4.1");                // "chat"
 */
export function inferModelKind(id: string): ModelKind {
  const name = id.toLowerCase();

  if (/embed/u.test(name)) {
    return "embedding";
  }

  if (/moderation|guard|safeguard/u.test(name)) {
    return "moderation";
  }

  if (/dall-e|gpt-image|imagen|image-generation|-image(?:-|$)|imagine|veo-|sora/u.test(name)) {
    return "image";
  }

  if (/whisper|\btts\b|tts-|transcribe|speech|audio|realtime|orpheus/u.test(name)) {
    return "audio";
  }

  return "chat";
}
