import { describe, expect, it } from "vitest";
import { ProviderRateLimitError } from "../errors/provider-rate-limit-error";
import { MockModel } from "../mock/mock-model";
import { fallbackModel } from "../model/fallback-model";
import { agent } from "./agent";

describe("agent — fallbackTrips on the report", () => {
  it("counts trips answered after a fallback", async () => {
    const primary = new MockModel("primary", [
      { content: "", error: new ProviderRateLimitError("429") },
    ]);
    const backup = new MockModel("backup", [{ content: "ok", finishReason: "stop" }]);

    const result = await agent({ model: fallbackModel([primary, backup]) }).execute("hi");

    expect(result.report.fallbackTrips).toBe(1);
  });

  it("leaves the field off when the first model answers", async () => {
    const primary = new MockModel("primary", [{ content: "ok", finishReason: "stop" }]);
    const backup = new MockModel("backup", [{ content: "ok", finishReason: "stop" }]);

    const result = await agent({ model: fallbackModel([primary, backup]) }).execute("hi");

    expect("fallbackTrips" in result.report).toBe(false);
  });
});
