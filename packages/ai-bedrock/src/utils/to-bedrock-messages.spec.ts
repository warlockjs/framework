import { InvalidRequestError, type Message } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { toBedrockMessages } from "./to-bedrock-messages";

describe("toBedrockMessages", () => {
  it("hoists system messages into a separate SystemContentBlock[]", () => {
    const messages: Message[] = [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hi" },
    ];

    expect(toBedrockMessages(messages)).toEqual({
      system: [{ text: "Be concise." }],
      messages: [{ role: "user", content: [{ text: "Hi" }] }],
    });
  });

  it("leaves system undefined when there is none", () => {
    expect(toBedrockMessages([{ role: "user", content: "Hi" }]).system).toBeUndefined();
  });

  it("converts tool messages into a user turn with a toolResult block", () => {
    const messages: Message[] = [{ role: "tool", toolCallId: "tu_1", content: '{"ok":true}' }];

    expect(toBedrockMessages(messages).messages).toEqual([
      {
        role: "user",
        content: [{ toolResult: { toolUseId: "tu_1", content: [{ text: '{"ok":true}' }] } }],
      },
    ]);
  });

  it("emits assistant tool calls as text + toolUse blocks", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "Let me check.",
        toolCalls: [{ id: "tu_1", name: "getWeather", input: { city: "Cairo" } }],
      },
    ];

    expect(toBedrockMessages(messages).messages).toEqual([
      {
        role: "assistant",
        content: [
          { text: "Let me check." },
          { toolUse: { toolUseId: "tu_1", name: "getWeather", input: { city: "Cairo" } } },
        ],
      },
    ]);
  });

  it("omits the leading text block when assistant content is empty", () => {
    const messages: Message[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "tu_1", name: "noop", input: {} }] },
    ];

    expect(toBedrockMessages(messages).messages).toEqual([
      { role: "assistant", content: [{ toolUse: { toolUseId: "tu_1", name: "noop", input: {} } }] },
    ]);
  });

  it("maps a base64 image into a bytes image block", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image", source: { base64: "aGVsbG8=", mediaType: "image/png" } },
        ],
      },
    ];

    const result = toBedrockMessages(messages).messages[0];
    const imageBlock = (result.content as Array<{ image?: { format: string; source: { bytes: Uint8Array } } }>)[1];

    expect(imageBlock.image?.format).toBe("png");
    expect(Buffer.from(imageBlock.image!.source.bytes).toString()).toBe("hello");
  });

  it("throws InvalidRequestError for remote-URL image sources", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "image", source: { url: "https://x/cat.jpg" } }] },
    ];

    expect(() => toBedrockMessages(messages)).toThrow(InvalidRequestError);
  });

  it("throws InvalidRequestError for an unsupported image media type", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "image", source: { base64: "x", mediaType: "image/svg+xml" } }],
      },
    ];

    expect(() => toBedrockMessages(messages)).toThrow(InvalidRequestError);
  });

  it("collapses a multipart system message to concatenated text", () => {
    const messages: Message[] = [
      {
        role: "system",
        content: [
          { type: "text", text: "Be " },
          { type: "text", text: "terse." },
        ],
      },
      { role: "user", content: "Hi" },
    ];

    expect(toBedrockMessages(messages).system).toEqual([{ text: "Be terse." }]);
  });

  it("drops non-text parts when stringifying a non-user message", () => {
    // Image parts are only meaningful on user turns; on a system turn they
    // are filtered out of the concatenated text.
    const messages: Message[] = [
      {
        role: "system",
        content: [
          { type: "text", text: "keep" },
          { type: "image", source: { base64: "aGk=", mediaType: "image/png" } },
        ],
      },
    ];

    expect(toBedrockMessages(messages).system).toEqual([{ text: "keep" }]);
  });

  it("defaults a tool message's toolUseId to an empty string when missing", () => {
    const messages: Message[] = [{ role: "tool", content: '{"ok":true}' }];

    expect(toBedrockMessages(messages).messages).toEqual([
      {
        role: "user",
        content: [{ toolResult: { toolUseId: "", content: [{ text: '{"ok":true}' }] } }],
      },
    ]);
  });

  it("defaults a tool call's input to {} when undefined", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "tu_9", name: "ping", input: undefined as unknown as Record<string, unknown> },
        ],
      },
    ];

    expect(toBedrockMessages(messages).messages).toEqual([
      { role: "assistant", content: [{ toolUse: { toolUseId: "tu_9", name: "ping", input: {} } }] },
    ]);
  });

  it("emits multiple tool calls in order after the optional text block", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "thinking",
        toolCalls: [
          { id: "a", name: "first", input: { n: 1 } },
          { id: "b", name: "second", input: { n: 2 } },
        ],
      },
    ];

    expect(toBedrockMessages(messages).messages).toEqual([
      {
        role: "assistant",
        content: [
          { text: "thinking" },
          { toolUse: { toolUseId: "a", name: "first", input: { n: 1 } } },
          { toolUse: { toolUseId: "b", name: "second", input: { n: 2 } } },
        ],
      },
    ]);
  });

  it("maps a plain-string assistant message (no tool calls) to a text block", () => {
    const messages: Message[] = [{ role: "assistant", content: "All done." }];

    expect(toBedrockMessages(messages).messages).toEqual([
      { role: "assistant", content: [{ text: "All done." }] },
    ]);
  });

  it("maps a plain-string user message to a single text block", () => {
    expect(toBedrockMessages([{ role: "user", content: "Hello" }]).messages).toEqual([
      { role: "user", content: [{ text: "Hello" }] },
    ]);
  });

  it("treats an empty toolCalls array as a plain assistant message", () => {
    // The toolCalls branch requires length > 0; an empty array falls through
    // to the default text-block mapping.
    const messages: Message[] = [{ role: "assistant", content: "hi", toolCalls: [] }];

    expect(toBedrockMessages(messages).messages).toEqual([
      { role: "assistant", content: [{ text: "hi" }] },
    ]);
  });

  it("preserves the order of mixed text and image parts on a user message", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "before" },
          { type: "image", source: { base64: "aGVsbG8=", mediaType: "image/jpeg" } },
          { type: "text", text: "after" },
        ],
      },
    ];

    const content = toBedrockMessages(messages).messages[0].content as Array<{
      text?: string;
      image?: { format: string };
    }>;

    expect(content[0]).toEqual({ text: "before" });
    expect(content[1].image?.format).toBe("jpeg");
    expect(content[2]).toEqual({ text: "after" });
  });

  it("maps gif and webp media types to their Bedrock formats", () => {
    const formatFor = (mediaType: string) => {
      const result = toBedrockMessages([
        { role: "user", content: [{ type: "image", source: { base64: "aGk=", mediaType } }] },
      ]).messages[0].content as Array<{ image?: { format: string } }>;

      return result[0].image?.format;
    };

    expect(formatFor("image/gif")).toBe("gif");
    expect(formatFor("image/webp")).toBe("webp");
  });

  it("stringifies a multipart assistant message that has no tool calls", () => {
    // Multipart content only maps to blocks on user turns; an assistant
    // ContentPart[] falls to the default branch and collapses to text.
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "part-a " },
          { type: "text", text: "part-b" },
        ],
      },
    ];

    expect(toBedrockMessages(messages).messages).toEqual([
      { role: "assistant", content: [{ text: "part-a part-b" }] },
    ]);
  });

  it("returns empty system and empty messages for an empty input", () => {
    expect(toBedrockMessages([])).toEqual({ system: undefined, messages: [] });
  });

  it("interleaves system hoisting with a full multi-turn conversation", () => {
    const messages: Message[] = [
      { role: "system", content: "S" },
      { role: "user", content: "U1" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "look", input: { q: "x" } }],
      },
      { role: "tool", toolCallId: "t1", content: '{"r":1}' },
      { role: "assistant", content: "Done." },
    ];

    const { system, messages: out } = toBedrockMessages(messages);

    expect(system).toEqual([{ text: "S" }]);
    expect(out).toEqual([
      { role: "user", content: [{ text: "U1" }] },
      {
        role: "assistant",
        content: [{ toolUse: { toolUseId: "t1", name: "look", input: { q: "x" } } }],
      },
      {
        role: "user",
        content: [{ toolResult: { toolUseId: "t1", content: [{ text: '{"r":1}' }] } }],
      },
      { role: "assistant", content: [{ text: "Done." }] },
    ]);
  });
});
