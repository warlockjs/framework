import { verifyModelSignalContract } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { OpenAISDK } from "./sdk";

/**
 * Adapter contract: aborting `ModelCallOptions.signal` rejects the call and
 * cancels the HTTP request, for `complete()` and `stream()`, on both the
 * Chat Completions and the Responses API models.
 */
describe("OpenAI adapter signal contract", () => {
  it.each(["chat", "responses"] as const)("the %s api honours the abort signal", async (api) => {
    const report = await verifyModelSignalContract({
      createModel: ({ baseURL }) =>
        new OpenAISDK({ apiKey: "test-key", baseURL, maxRetries: 0 }).model({
          name: "gpt-4o-mini",
          api,
        }),
    });

    expect(report.checks).toHaveLength(4);
  });
});
