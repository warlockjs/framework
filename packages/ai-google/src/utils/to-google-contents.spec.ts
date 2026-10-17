import { InvalidRequestError, type Message, type ModelToolCallRequest } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { toGoogleContents } from "./to-google-contents";

describe("toGoogleContents", () => {
  it("hoists system messages into systemInstruction", () => {
    const messages: Message[] = [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hi" },
    ];

    expect(toGoogleContents(messages)).toEqual({
      systemInstruction: "Be concise.",
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
    });
  });

  it("joins multiple system messages and leaves it undefined when none", () => {
    expect(
      toGoogleContents([
        { role: "system", content: "A" },
        { role: "system", content: "B" },
        { role: "user", content: "x" },
      ]).systemInstruction,
    ).toBe("A\n\nB");

    expect(toGoogleContents([{ role: "user", content: "x" }]).systemInstruction).toBeUndefined();
  });

  it("maps assistant role to 'model'", () => {
    expect(toGoogleContents([{ role: "assistant", content: "hi" }]).contents).toEqual([
      { role: "model", parts: [{ text: "hi" }] },
    ]);
  });

  it("converts a tool message into a user functionResponse part (JSON parsed)", () => {
    const messages: Message[] = [{ role: "tool", toolCallId: "tc_1", content: '{"ok":true}' }];

    expect(toGoogleContents(messages).contents).toEqual([
      {
        role: "user",
        parts: [{ functionResponse: { name: "tc_1", response: { ok: true } } }],
      },
    ]);
  });

  it("wraps a non-JSON tool result under a result key", () => {
    const messages: Message[] = [{ role: "tool", toolCallId: "tc_1", content: "plain text" }];

    expect(toGoogleContents(messages).contents[0].parts).toEqual([
      { functionResponse: { name: "tc_1", response: { result: "plain text" } } },
    ]);
  });

  it("wraps a JSON array tool result under a result key (only objects pass through)", () => {
    const messages: Message[] = [{ role: "tool", toolCallId: "tc_1", content: "[1,2,3]" }];

    expect(toGoogleContents(messages).contents[0].parts).toEqual([
      { functionResponse: { name: "tc_1", response: { result: "[1,2,3]" } } },
    ]);
  });

  it("wraps a JSON scalar / 'null' tool result under a result key", () => {
    const numeric = toGoogleContents([{ role: "tool", toolCallId: "tc_1", content: "42" }]);
    const literalNull = toGoogleContents([{ role: "tool", toolCallId: "tc_2", content: "null" }]);

    expect(numeric.contents[0].parts).toEqual([
      { functionResponse: { name: "tc_1", response: { result: "42" } } },
    ]);
    expect(literalNull.contents[0].parts).toEqual([
      { functionResponse: { name: "tc_2", response: { result: "null" } } },
    ]);
  });

  it("falls back to an empty functionResponse name when toolCallId is absent", () => {
    const messages: Message[] = [{ role: "tool", content: '{"ok":true}' }];

    expect(toGoogleContents(messages).contents[0].parts).toEqual([
      { functionResponse: { name: "", response: { ok: true } } },
    ]);
  });

  it("emits assistant tool calls as text + functionCall parts", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "checking",
        toolCalls: [{ id: "tc_1", name: "getWeather", input: { city: "Cairo" } }],
      },
    ];

    expect(toGoogleContents(messages).contents).toEqual([
      {
        role: "model",
        parts: [
          { text: "checking" },
          { functionCall: { name: "getWeather", args: { city: "Cairo" } } },
        ],
      },
    ]);
  });

  it("collapses multipart assistant content to a leading text part before tool calls", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me " },
          { type: "text", text: "check" },
        ],
        toolCalls: [{ id: "tc_1", name: "getWeather", input: { city: "Cairo" } }],
      },
    ];

    expect(toGoogleContents(messages).contents).toEqual([
      {
        role: "model",
        parts: [
          { text: "let me check" },
          { functionCall: { name: "getWeather", args: { city: "Cairo" } } },
        ],
      },
    ]);
  });

  it("omits the leading text part when assistant tool-call content is empty", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc_1", name: "ping", input: {} }],
      },
    ];

    expect(toGoogleContents(messages).contents).toEqual([
      { role: "model", parts: [{ functionCall: { name: "ping", args: {} } }] },
    ]);
  });

  it("defaults tool-call args to an empty object when input is undefined", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc_1", name: "ping" } as unknown as ModelToolCallRequest],
      },
    ];

    expect(toGoogleContents(messages).contents[0].parts).toEqual([
      { functionCall: { name: "ping", args: {} } },
    ]);
  });

  it("ignores a non-string thoughtSignature on the tool call", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc_1",
            name: "getWeather",
            input: { city: "Cairo" },
            providerMetadata: { thoughtSignature: 123 as unknown as string },
          },
        ],
      },
    ];

    expect(toGoogleContents(messages).contents[0].parts).toEqual([
      { functionCall: { name: "getWeather", args: { city: "Cairo" } } },
    ]);
  });

  it("replays providerMetadata.thoughtSignature on the functionCall part", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc_1",
            name: "getWeather",
            input: { city: "Cairo" },
            providerMetadata: { thoughtSignature: "sig-abc" },
          },
        ],
      },
    ];

    expect(toGoogleContents(messages).contents).toEqual([
      {
        role: "model",
        parts: [
          {
            thoughtSignature: "sig-abc",
            functionCall: { name: "getWeather", args: { city: "Cairo" } },
          },
        ],
      },
    ]);
  });

  it("maps a base64 image into an inlineData part", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this" },
          { type: "image", source: { base64: "aGk=", mediaType: "image/png" } },
        ],
      },
    ];

    expect(toGoogleContents(messages).contents).toEqual([
      {
        role: "user",
        parts: [{ text: "what is this" }, { inlineData: { mimeType: "image/png", data: "aGk=" } }],
      },
    ]);
  });

  it("throws InvalidRequestError for remote-URL image sources", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "image", source: { url: "https://x/cat.jpg" } }] },
    ];

    expect(() => toGoogleContents(messages)).toThrow(InvalidRequestError);
  });

  it("maps a user array of only text parts to individual text parts", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      },
    ];

    expect(toGoogleContents(messages).contents).toEqual([
      { role: "user", parts: [{ text: "one" }, { text: "two" }] },
    ]);
  });

  it("collapses an assistant array content WITHOUT tool calls to a single joined text part", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "foo" },
          { type: "text", text: "bar" },
        ],
      },
    ];

    expect(toGoogleContents(messages).contents).toEqual([
      { role: "model", parts: [{ text: "foobar" }] },
    ]);
  });

  it("ignores an empty assistant toolCalls array (falls to the plain text branch)", () => {
    const messages: Message[] = [{ role: "assistant", content: "hi", toolCalls: [] }];

    expect(toGoogleContents(messages).contents).toEqual([
      { role: "model", parts: [{ text: "hi" }] },
    ]);
  });

  it("preserves interleaved order of system, user, assistant, and tool turns", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "tool", toolCallId: "tc", content: "done" },
      { role: "user", content: "u2" },
    ];

    const { systemInstruction, contents } = toGoogleContents(messages);

    expect(systemInstruction).toBe("sys");
    // The tool result and the following user turn share a role, so they merge.
    expect(contents.map((content) => content.role)).toEqual(["user", "model", "user"]);
    expect(contents[2]?.parts).toEqual([
      { functionResponse: { name: "tc", response: { result: "done" } } },
      { text: "u2" },
    ]);
  });
});

describe("toGoogleContents adjacent same-role turns", () => {
  it("sends consecutive tool results as one user turn, in order", () => {
    const messages: Message[] = [
      { role: "user", content: "look both up" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "first", name: "first", input: {} },
          { id: "second", name: "second", input: {} },
        ],
      },
      { role: "tool", toolCallId: "first", content: '{"a":1}' },
      { role: "tool", toolCallId: "second", content: '{"b":2}' },
    ];

    const { contents } = toGoogleContents(messages);

    expect(contents.map((content) => content.role)).toEqual(["user", "model", "user"]);
    expect(contents[2]).toEqual({
      role: "user",
      parts: [
        { functionResponse: { name: "first", response: { a: 1 } } },
        { functionResponse: { name: "second", response: { b: 2 } } },
      ],
    });
  });

  it("merges a user-framed compaction summary with the following user input", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "Summary of earlier conversation:\nmemo",
        compaction: "summary",
      },
      { role: "user", content: "the task" },
    ];

    expect(toGoogleContents(messages).contents).toEqual([
      {
        role: "user",
        parts: [{ text: "Summary of earlier conversation:\nmemo" }, { text: "the task" }],
      },
    ]);
  });

  it("merges an assistant summary with a following signed tool call, text first", () => {
    const toolCall: ModelToolCallRequest = {
      id: "lookup",
      name: "lookup",
      input: { q: "x" },
      providerMetadata: { thoughtSignature: "sig-1" },
    };
    const messages: Message[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "memo", compaction: "summary" },
      { role: "assistant", content: "", toolCalls: [toolCall] },
    ];

    expect(toGoogleContents(messages).contents).toEqual([
      { role: "user", parts: [{ text: "go" }] },
      {
        role: "model",
        parts: [
          { text: "memo" },
          { thoughtSignature: "sig-1", functionCall: { name: "lookup", args: { q: "x" } } },
        ],
      },
    ]);
  });

  it("does not modify the caller's messages", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "user", content: "b" },
      { role: "tool", toolCallId: "t1", content: "1" },
      { role: "tool", toolCallId: "t2", content: "2" },
    ];
    const before = structuredClone(messages);

    const first = toGoogleContents(messages);
    const second = toGoogleContents(messages);

    expect(messages).toEqual(before);
    expect(first).toEqual(second);
    expect(first.contents).toHaveLength(1);
  });

  it("keeps strictly alternating roles across a multi-trip compacted history", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      {
        role: "user",
        content: "Summary of earlier conversation:\nmemo",
        compaction: "summary",
      },
      { role: "user", content: "task" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "a", input: {} },
          { id: "b", name: "b", input: {} },
        ],
      },
      { role: "tool", toolCallId: "a", content: "1" },
      { role: "tool", toolCallId: "b", content: "2" },
      { role: "assistant", content: "memo two", compaction: "summary" },
      { role: "assistant", content: "", toolCalls: [{ id: "c", name: "c", input: {} }] },
      { role: "tool", toolCallId: "c", content: "3" },
    ];

    const roles = toGoogleContents(messages).contents.map((content) => content.role);

    expect(roles).toEqual(["user", "model", "user", "model", "user"]);
  });
});
