import { verifyModelSignalContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { GroqSDK } from "./sdk";

/**
 * Adapter contract: aborting `ModelCallOptions.signal` rejects the call and
 * cancels the HTTP request, for `complete()` and `stream()`.
 */
describe("Groq adapter signal contract", () => {
  it("honours the abort signal", async () => {
    const report = await verifyModelSignalContract({
      createModel: ({ baseURL }) =>
        new GroqSDK({ apiKey: "test-key", baseURL, maxRetries: 0 }).model({
          name: "llama-3.3-70b-versatile",
        }),
    });

    expect(report.checks).toHaveLength(4);
  });
});
