import { verifyModelSignalContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { MistralSDK } from "./sdk";

/**
 * Adapter contract: aborting `ModelCallOptions.signal` rejects the call and
 * cancels the HTTP request, for `complete()` and `stream()`.
 */
describe("Mistral adapter signal contract", () => {
  it("honours the abort signal", async () => {
    const report = await verifyModelSignalContract({
      createModel: ({ baseURL }) =>
        new MistralSDK({ apiKey: "test-key", baseURL, maxRetries: 0 }).model({
          name: "mistral-large-latest",
        }),
    });

    expect(report.checks).toHaveLength(4);
  });
});
