import { ai } from "@warlock.js/ai";
import { realtime } from "./realtime/realtime";
import { video } from "./video/video";

/**
 * Augment the shared `Ai` facade with this package's two heavy
 * modalities. Importing `@warlock.js/ai-live` mounts `ai.video` +
 * `ai.realtime` as a side effect, mirroring how `@warlock.js/ai-tools`
 * mounts `ai.mcp` / `ai.tools` and `@warlock.js/ai-workspace` mounts
 * `ai.workspace`.
 */
declare module "@warlock.js/ai" {
  interface Ai {
    /**
     * Text-to-video generation (Sora / Veo / Kling-class). Async under
     * the hood (submit→poll), surfaced as the uniform never-throws
     * `{ data, error, usage, report }` envelope. Ships in `@warlock.js/ai-live`.
     */
    video: typeof video;
    /**
     * Live duplex voice sessions (OpenAI Realtime-class). A stateful
     * session over a pluggable transport — push audio/text in, consume
     * events out, `close()` for a report. Ships in `@warlock.js/ai-live`.
     */
    realtime: typeof realtime;
  }
}

ai.video = video;
ai.realtime = realtime;

export { realtime, video };
export type { VideoData, VideoParams, VideoReport, VideoResult } from "./video/video";
export * from "./contracts/video.contract";
export * from "./contracts/realtime.contract";
export * from "./mock";
