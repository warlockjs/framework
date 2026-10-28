import { ProviderAuthError } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { GoogleSDK } from "./sdk";

function sdkListing(listing: () => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>) {
  const sdk = new GoogleSDK({ apiKey: "k" });
  const list = vi.fn(async (_params?: unknown) => listing());
  (sdk as unknown as { ai: { models: { list: typeof list } } }).ai.models.list = list;

  return { sdk, list };
}

async function* rows(...items: unknown[]) {
  for (const item of items) yield item;
}

describe("GoogleSDK.models()", () => {
  it("maps Gemini models, strips models/ and classifies by supportedActions", async () => {
    const { sdk } = sdkListing(() =>
      rows(
        {
          name: "models/gemini-2.5-flash",
          displayName: "Gemini 2.5 Flash",
          description: "Fast",
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
          supportedActions: ["generateContent", "countTokens"],
        },
        {
          name: "models/gemini-embedding-001",
          displayName: "Gemini Embedding",
          supportedActions: ["embedContent"],
        },
        { name: "models/imagen-4.0-generate-001", supportedActions: ["predict"] },
        { name: "models/gemini-2.5-flash-preview-tts", supportedActions: ["generateContent"] },
        { displayName: "no name" },
      ),
    );
    const models = await sdk.models();

    expect(models).toEqual([
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        provider: "google",
        kind: "chat",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        description: "Fast",
      },
      {
        id: "gemini-embedding-001",
        label: "Gemini Embedding",
        provider: "google",
        kind: "embedding",
      },
      {
        id: "imagen-4.0-generate-001",
        label: "imagen-4.0-generate-001",
        provider: "google",
        kind: "image",
      },
      {
        id: "gemini-2.5-flash-preview-tts",
        label: "gemini-2.5-flash-preview-tts",
        provider: "google",
        kind: "audio",
      },
    ]);
  });

  it("asks for large pages and forwards the abort signal", async () => {
    const controller = new AbortController();
    const { sdk, list } = sdkListing(() => rows());
    await sdk.models({ signal: controller.signal });

    expect(list.mock.calls[0]?.[0]).toMatchObject({
      config: { pageSize: 1000, abortSignal: controller.signal },
    });
  });

  it("wraps failures as provider errors", async () => {
    const { sdk } = sdkListing(() => {
      throw Object.assign(new Error("API key not valid"), { status: 401 });
    });

    await expect(sdk.models()).rejects.toBeInstanceOf(ProviderAuthError);
  });
});
