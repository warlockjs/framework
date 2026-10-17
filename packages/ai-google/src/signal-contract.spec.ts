import { verifyModelSignalContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { GoogleSDK } from "./sdk";

/**
 * Adapter contract: aborting `ModelCallOptions.signal` rejects the call and
 * cancels the HTTP request, for `complete()` and `stream()`.
 */
describe("Google adapter signal contract", () => {
  it("honours the abort signal", async () => {
    const report = await verifyModelSignalContract({
      createModel: ({ baseURL }) =>
        new GoogleSDK({ apiKey: "test-key", httpOptions: { baseUrl: baseURL } }).model({
          name: "gemini-2.5-flash",
        }),
    });

    expect(report.checks).toHaveLength(4);
  });
});
