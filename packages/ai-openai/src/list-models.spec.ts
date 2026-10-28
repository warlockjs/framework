import { ProviderAuthError } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { toModelInfo } from "./list-models";
import { OpenAISDK } from "./sdk";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAISDK.models()", () => {
  it("lists GET /models into the common shape and tags the SDK's provider label", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        object: "list",
        data: [
          { id: "gpt-4.1", object: "model", created: 1_700_000_000, owned_by: "openai" },
          { id: "text-embedding-3-small", object: "model", created: 1_600_000_000 },
          { id: "gpt-image-1", object: "model", created: 1_650_000_000 },
          { id: "whisper-1", object: "model", created: 1_600_000_001 },
        ],
      }),
    );
    const models = await new OpenAISDK({ apiKey: "k", fetch }).models();

    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/models");
    expect(models).toEqual([
      { id: "gpt-4.1", label: "gpt-4.1", provider: "openai", kind: "chat", created: 1_700_000_000 },
      {
        id: "text-embedding-3-small",
        label: "text-embedding-3-small",
        provider: "openai",
        kind: "embedding",
        created: 1_600_000_000,
      },
      {
        id: "gpt-image-1",
        label: "gpt-image-1",
        provider: "openai",
        kind: "image",
        created: 1_650_000_000,
      },
      {
        id: "whisper-1",
        label: "whisper-1",
        provider: "openai",
        kind: "audio",
        created: 1_600_000_001,
      },
    ]);
  });

  it("uses the relabelled provider and follows pagination to the end", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ data: [{ id: "a" }], has_more: true, last_id: "a" }))
      .mockResolvedValueOnce(json({ data: [{ id: "a" }, { id: "b" }], has_more: false }));
    const models = await new OpenAISDK({ apiKey: "k", fetch, provider: "gateway" }).models();

    expect(models.map((model) => [model.id, model.provider])).toEqual([
      ["a", "gateway"],
      ["b", "gateway"],
    ]);
  });

  it("throws a provider error instead of returning an empty list on failure", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        json({ error: { message: "bad key", type: "invalid_request_error" } }, 401),
      );

    await expect(
      new OpenAISDK({ apiKey: "k", fetch, maxRetries: 0 }).models(),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it("passes the caller's abort signal to the request", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ data: [] }));
    await new OpenAISDK({ apiKey: "k", fetch }).models({ signal: controller.signal });

    expect(fetch.mock.calls[0]?.[1]?.signal).toBeDefined();
  });
});

describe("toModelInfo", () => {
  it("reads Groq context_window and drops inactive models", () => {
    expect(
      toModelInfo({ id: "llama-3.3-70b-versatile", context_window: 131072, active: true }, "groq"),
    ).toMatchObject({ id: "llama-3.3-70b-versatile", contextWindow: 131072, kind: "chat" });
    expect(toModelInfo({ id: "old", active: false }, "groq")).toBeUndefined();
  });

  it("reads Mistral name, description, context length and capabilities", () => {
    expect(
      toModelInfo(
        {
          id: "mistral-large-latest",
          name: "Mistral Large",
          description: "Flagship",
          max_context_length: 128000,
          created: 1_700_000_000,
          capabilities: { completion_chat: true },
        },
        "mistral",
      ),
    ).toEqual({
      id: "mistral-large-latest",
      label: "Mistral Large",
      provider: "mistral",
      kind: "chat",
      created: 1_700_000_000,
      contextWindow: 128000,
      description: "Flagship",
    });
    expect(
      toModelInfo({ id: "mistral-ocr-latest", capabilities: { completion_chat: false } }, "mistral")
        ?.kind,
    ).toBe("other");
  });

  it("accepts a created_at date string and skips rows without an id", () => {
    expect(toModelInfo({ id: "m", created_at: "2025-01-01T00:00:00Z" }, "p")?.created).toBe(
      1_735_689_600,
    );
    expect(toModelInfo({ name: "no id" }, "p")).toBeUndefined();
    expect(toModelInfo(null, "p")).toBeUndefined();
  });
});
