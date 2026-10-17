import { verifyModelSignalContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { DeepSeekSDK } from "./sdk";

/**
 * Adapter contract: aborting `ModelCallOptions.signal` rejects the call and
 * cancels the HTTP request, for `complete()` and `stream()`.
 */
describe("DeepSeek adapter signal contract", () => {
  it("honours the abort signal", async () => {
    const report = await verifyModelSignalContract({
      createModel: ({ baseURL }) =>
        new DeepSeekSDK({ apiKey: "test-key", baseURL, maxRetries: 0 }).model({
          name: "deepseek-chat",
        }),
    });

    expect(report.checks).toHaveLength(4);
  });
});
