import { verifyModelSignalContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { BedrockSDK } from "./sdk";

/**
 * Adapter contract: aborting `ModelCallOptions.signal` rejects the call and
 * cancels the HTTP request, for `complete()` and `stream()`.
 */
describe("Bedrock adapter signal contract", () => {
  it("honours the abort signal", async () => {
    const report = await verifyModelSignalContract({
      // The AWS SDK's default Node handler for Bedrock Runtime speaks HTTP/2.
      protocol: "http2",
      createModel: ({ baseURL }) =>
        new BedrockSDK({
          apiKey: "test-key",
          region: "us-east-1",
          endpoint: baseURL,
          maxAttempts: 1,
        }).model({ name: "amazon.nova-pro-v1:0" }),
    });

    expect(report.checks).toHaveLength(4);
  });
});
