import { verifyModelSignalContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { XaiSDK } from "./sdk";

/**
 * Adapter contract: aborting `ModelCallOptions.signal` rejects the call and
 * cancels the HTTP request, for `complete()` and `stream()`.
 */
describe("xAI adapter signal contract", () => {
  it("honours the abort signal", async () => {
    const report = await verifyModelSignalContract({
      createModel: ({ baseURL }) =>
        new XaiSDK({ apiKey: "test-key", baseURL, maxRetries: 0 }).model({ name: "grok-4" }),
    });

    expect(report.checks).toHaveLength(4);
  });
});
