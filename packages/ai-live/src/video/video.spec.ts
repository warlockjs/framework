import type { Observer } from "@warlock.js/ai";
import { ProviderError, ProviderRateLimitError } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { MockVideoModel } from "../mock";
import { video } from "./video";

describe("ai.video", () => {
  it("returns the generated video on success", async () => {
    const model = new MockVideoModel("sora-2", [{}]);
    const result = await video({ model, prompt: "a sunset", durationSeconds: 5 });

    expect(result.type).toBe("video");
    expect(result.error).toBeUndefined();
    expect(result.report.status).toBe("completed");
    expect(result.data?.video).toMatchObject({ type: "url", mediaType: "video/mp4" });
  });

  it("never throws — surfaces a typed AIError on result.error", async () => {
    const rate = new ProviderRateLimitError("slow down");
    const model = new MockVideoModel("sora-2", [{ error: rate }]);
    const result = await video({ model, prompt: "x" });

    expect(result.error).toBe(rate);
    expect(result.data).toBeUndefined();
    expect(result.report.status).toBe("failed");
  });

  it("wraps a non-AIError in ProviderError", async () => {
    const model = new MockVideoModel("sora-2", [{ error: new Error("boom") }]);
    const result = await video({ model, prompt: "x" });
    expect(result.error).toBeInstanceOf(ProviderError);
  });

  it("prices per-second video into usage.cost", async () => {
    const model = new MockVideoModel("sora-2", [{ durationSeconds: 8 }], { perSecond: 0.1 });
    const result = await video({ model, prompt: "x", durationSeconds: 8 });
    expect(result.usage.cost?.output).toBeCloseTo(0.8, 10);
    expect(result.report.durationSeconds).toBe(8);
  });

  it("leaves usage.cost undefined when unpriced", async () => {
    const model = new MockVideoModel("sora-2", [{}]);
    const result = await video({ model, prompt: "x" });
    expect(result.usage.cost).toBeUndefined();
  });

  it("forwards options to the model", async () => {
    const model = new MockVideoModel("sora-2", [{}]);
    await video({
      model,
      prompt: "x",
      durationSeconds: 10,
      aspectRatio: "9:16",
      resolution: "1080p",
      negativePrompt: "blurry",
    });
    expect(model.calls[0].options).toMatchObject({
      durationSeconds: 10,
      aspectRatio: "9:16",
      resolution: "1080p",
      negativePrompt: "blurry",
    });
  });

  it("marks the run cancelled when the signal aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockVideoModel("sora-2", [{ error: new Error("aborted") }]);
    const result = await video({ model, prompt: "x", signal: controller.signal });
    expect(result.report.status).toBe("cancelled");
  });

  it("routes the report to a flow-local observer", async () => {
    const seen: string[] = [];
    const collector: Observer = { collect: (r) => void seen.push(`${r.type}:${r.status}`) };
    const model = new MockVideoModel("sora-2", [{}]);
    await video({ model, prompt: "x", observe: collector });
    expect(seen).toEqual(["video:completed"]);
  });

  it("builds a coherent report", async () => {
    const model = new MockVideoModel("sora-2", [{}]);
    const { report } = await video({ model, prompt: "x", sessionId: "s1" });
    expect(report.runId.startsWith("video_")).toBe(true);
    expect(report.type).toBe("video");
    expect(report.model).toEqual({ name: "sora-2", provider: "mock" });
    expect(report.sessionId).toBe("s1");
  });
});
