import { ProviderError } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { OllamaSDK } from "./sdk";

describe("OllamaSDK.models()", () => {
  it("lists GET /api/tags, using modified_at as created and encoder families as embeddings", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "llama3.1:8b",
              model: "llama3.1:8b",
              modified_at: "2025-01-01T00:00:00Z",
              size: 1,
              digest: "x",
              details: { family: "llama", families: ["llama"] },
            },
            {
              name: "nomic-embed-text:latest",
              model: "nomic-embed-text:latest",
              modified_at: "2025-01-02T00:00:00Z",
              size: 1,
              digest: "y",
              details: { family: "nomic-bert", families: ["nomic-bert"] },
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const models = await new OllamaSDK({ host: "http://127.0.0.1:11434", fetch }).models();

    expect(String(fetch.mock.calls[0]?.[0])).toBe("http://127.0.0.1:11434/api/tags");
    expect(models).toEqual([
      {
        id: "llama3.1:8b",
        label: "llama3.1:8b",
        provider: "ollama",
        kind: "chat",
        created: 1_735_689_600,
      },
      {
        id: "nomic-embed-text:latest",
        label: "nomic-embed-text:latest",
        provider: "ollama",
        kind: "embedding",
        created: 1_735_776_000,
      },
    ]);
  });

  it("throws a provider error when the host is down, never an empty list", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(
        Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
      );

    await expect(new OllamaSDK({ fetch }).models()).rejects.toBeInstanceOf(ProviderError);
  });

  it("cancels the request through the abort signal", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const pending = new OllamaSDK({ fetch }).models({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toBeDefined();
  });
});
