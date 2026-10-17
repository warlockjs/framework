import { verifyModelSignalContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { AnthropicSDK } from "./sdk";

/**
 * Adapter contract: aborting `ModelCallOptions.signal` rejects the call and
 * cancels the HTTP request, for `complete()` and `stream()`.
 */
describe("Anthropic adapter signal contract", () => {
  it("honours the abort signal", async () => {
    const report = await verifyModelSignalContract({
      createModel: ({ baseURL }) =>
        new AnthropicSDK({ apiKey: "test-key", baseURL, maxRetries: 0 }).model({
          name: "claude-opus-5-5",
        }),
    });

    expect(report.checks).toHaveLength(4);
  });
});
