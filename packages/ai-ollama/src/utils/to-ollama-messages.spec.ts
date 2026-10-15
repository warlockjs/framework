import { InvalidRequestError, type Message } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { toOllamaMessages } from "./to-ollama-messages";

describe("toOllamaMessages", () => {
  it("keeps system as a real role (no hoisting)", () => {
    const messages: Message[] = [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hi" },
    ];

    expect(toOllamaMessages(messages)).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hi" },
    ]);
  });

  it("maps a tool message to role tool with tool_name from toolCallId", () => {
    const messages: Message[] = [{ role: "tool", toolCallId: "getWeather", content: '{"t":1}' }];

    expect(toOllamaMessages(messages)).toEqual([
      { role: "tool", content: '{"t":1}', tool_name: "getWeather" },
    ]);
  });

  it("emits assistant tool calls in Ollama's function shape (no id)", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "checking",
        toolCalls: [{ id: "getWeather", name: "getWeather", input: { city: "Cairo" } }],
      },
    ];

    expect(toOllamaMessages(messages)).toEqual([
      {
        role: "assistant",
        content: "checking",
        tool_calls: [{ function: { name: "getWeather", arguments: { city: "Cairo" } } }],
      },
    ]);
  });

  it("collapses a multipart user message to content + base64 images", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this" },
          { type: "image", source: { base64: "aGk=", mediaType: "image/png" } },
        ],
      },
    ];

    expect(toOllamaMessages(messages)).toEqual([
      { role: "user", content: "what is this", images: ["aGk="] },
    ]);
  });

  it("omits images when there are none", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "plain" }] },
    ];

    expect(toOllamaMessages(messages)).toEqual([{ role: "user", content: "plain" }]);
  });

  it("throws InvalidRequestError for remote-URL image sources", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "image", source: { url: "https://x/cat.jpg" } }] },
    ];

    expect(() => toOllamaMessages(messages)).toThrow(InvalidRequestError);
  });

  it("falls back to tool_name '' when a tool message has no toolCallId", () => {
    const messages: Message[] = [{ role: "tool", content: '{"t":1}' }];

    expect(toOllamaMessages(messages)).toEqual([
      { role: "tool", content: '{"t":1}', tool_name: "" },
    ]);
  });

  it("stringifies tool-message content that arrives as content parts", () => {
    const messages: Message[] = [
      {
        role: "tool",
        toolCallId: "getWeather",
        content: [
          { type: "text", text: "82" },
          { type: "text", text: "F" },
        ],
      },
    ];

    expect(toOllamaMessages(messages)).toEqual([
      { role: "tool", content: "82F", tool_name: "getWeather" },
    ]);
  });

  it("treats an empty toolCalls array as a plain assistant message", () => {
    const messages: Message[] = [{ role: "assistant", content: "done", toolCalls: [] }];

    expect(toOllamaMessages(messages)).toEqual([{ role: "assistant", content: "done" }]);
  });

  it("defaults tool-call arguments to {} when input is missing", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "noArgs", name: "noArgs", input: undefined }],
      },
    ];

    expect(toOllamaMessages(messages)).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "noArgs", arguments: {} } }],
      },
    ]);
  });

  it("emits several assistant tool calls in order", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "a", input: { x: 1 } },
          { id: "b", name: "b", input: { y: 2 } },
        ],
      },
    ];

    expect(toOllamaMessages(messages)).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "a", arguments: { x: 1 } } },
          { function: { name: "b", arguments: { y: 2 } } },
        ],
      },
    ]);
  });

  it("joins multiple text parts in a multipart user message", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ],
      },
    ];

    expect(toOllamaMessages(messages)).toEqual([{ role: "user", content: "hello world" }]);
  });

  it("collects multiple base64 images and interleaves text in order", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "compare " },
          { type: "image", source: { base64: "aaa", mediaType: "image/png" } },
          { type: "text", text: "these" },
          { type: "image", source: { base64: "bbb", mediaType: "image/jpeg" } },
        ],
      },
    ];

    expect(toOllamaMessages(messages)).toEqual([
      { role: "user", content: "compare these", images: ["aaa", "bbb"] },
    ]);
  });

  it("collapses content parts on a non-user role to concatenated text only", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "part one " },
          { type: "image", source: { base64: "zzz", mediaType: "image/png" } },
          { type: "text", text: "part two" },
        ],
      },
    ];

    // Non-user roles never carry images; the image part is dropped.
    expect(toOllamaMessages(messages)).toEqual([
      { role: "assistant", content: "part one part two" },
    ]);
  });

  it("passes a plain-string user message straight through", () => {
    const messages: Message[] = [{ role: "user", content: "just text" }];

    expect(toOllamaMessages(messages)).toEqual([{ role: "user", content: "just text" }]);
  });
});
