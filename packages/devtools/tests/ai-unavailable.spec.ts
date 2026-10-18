import { describe, expect, it, vi } from "vitest";
vi.mock("@warlock.js/ai-panoptic", () => {
  throw new Error("Optional package not installed");
});
vi.mock("../src/current-request-id", () => ({ currentRequestId: () => undefined }));
import { attachAiSource } from "../src/sources/ai-source";

describe("optional Panoptic integration", () => {
  it("returns install guidance when the package cannot be imported", async () => {
    const source = await attachAiSource(200);
    expect(source).toMatchObject({
      available: false,
      message: expect.stringContaining("Install @warlock.js/ai"),
    });
    expect(() => source.dispose()).not.toThrow();
  });
});
