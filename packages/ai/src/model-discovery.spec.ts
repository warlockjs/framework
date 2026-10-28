import { describe, expect, it } from "vitest";
import { inferModelKind } from "./model-discovery";

describe("inferModelKind", () => {
  it.each([
    ["text-embedding-3-small", "embedding"],
    ["mistral-embed", "embedding"],
    ["omni-moderation-latest", "moderation"],
    ["gpt-image-1", "image"],
    ["dall-e-3", "image"],
    ["whisper-large-v3", "audio"],
    ["tts-1", "audio"],
    ["gpt-4o-realtime-preview", "audio"],
    ["gpt-4.1", "chat"],
    ["claude-sonnet-4-5", "chat"],
    ["llama3.1:8b", "chat"],
  ])("classifies %s as %s", (id, kind) => {
    expect(inferModelKind(id)).toBe(kind);
  });
});
