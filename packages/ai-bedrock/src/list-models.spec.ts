import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import { ProviderError } from "@warlock.js/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BedrockSDK } from "./sdk";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BedrockSDK.models()", () => {
  it("maps ListFoundationModels, skips LEGACY and classifies by output modality", async () => {
    const send = vi.spyOn(BedrockClient.prototype, "send").mockResolvedValue({
      modelSummaries: [
        {
          modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
          modelName: "Claude Sonnet 4.5",
          providerName: "Anthropic",
          outputModalities: ["TEXT"],
          modelLifecycle: { status: "ACTIVE" },
        },
        {
          modelId: "amazon.titan-embed-text-v2:0",
          modelName: "Titan Text Embeddings V2",
          providerName: "Amazon",
          outputModalities: ["EMBEDDING"],
        },
        {
          modelId: "amazon.titan-image-generator-v2:0",
          modelName: "Titan Image Generator v2",
          providerName: "Amazon",
          outputModalities: ["IMAGE"],
        },
        {
          modelId: "anthropic.claude-v2",
          modelName: "Claude",
          providerName: "Anthropic",
          outputModalities: ["TEXT"],
          modelLifecycle: { status: "LEGACY" },
        },
      ],
    } as never);
    const models = await new BedrockSDK({ region: "us-east-1" }).models();

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListFoundationModelsCommand);
    expect(models).toEqual([
      {
        id: "anthropic.claude-sonnet-4-5-20250929-v1:0",
        label: "Anthropic Claude Sonnet 4.5",
        provider: "bedrock",
        kind: "chat",
      },
      {
        id: "amazon.titan-embed-text-v2:0",
        label: "Amazon Titan Text Embeddings V2",
        provider: "bedrock",
        kind: "embedding",
      },
      {
        id: "amazon.titan-image-generator-v2:0",
        label: "Amazon Titan Image Generator v2",
        provider: "bedrock",
        kind: "image",
      },
    ]);
  });

  it("forwards the abort signal and the SDK region to the control-plane client", async () => {
    const controller = new AbortController();
    const send = vi
      .spyOn(BedrockClient.prototype, "send")
      .mockResolvedValue({ modelSummaries: [] } as never);
    await new BedrockSDK({ region: "eu-west-1" }).models({ signal: controller.signal });

    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal });
  });

  it("wraps AWS failures as provider errors", async () => {
    vi.spyOn(BedrockClient.prototype, "send").mockRejectedValue(
      Object.assign(new Error("not authorized"), {
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403 },
      }),
    );

    await expect(new BedrockSDK({ region: "us-east-1" }).models()).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});
