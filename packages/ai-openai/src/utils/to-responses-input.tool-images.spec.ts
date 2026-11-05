import type { Message } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { toResponsesInput } from "./to-responses-input";

const messages: Message[] = [
  {
    role: "tool",
    toolCallId: "c1",
    content: [
      { type: "text", text: "shot" },
      { type: "image", source: { base64: "AAAA", mediaType: "image/png" } },
    ],
  },
];

describe("toResponsesInput tool result images", () => {
  it("sends input_text and input_image items when the model reads tool images", () => {
    expect(toResponsesInput(messages, undefined, true).input).toEqual([
      {
        type: "function_call_output",
        call_id: "c1",
        output: [
          { type: "input_text", text: "shot" },
          { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" },
        ],
      },
    ]);
  });

  it("falls back to the placeholder text otherwise", () => {
    expect(toResponsesInput(messages).input).toEqual([
      {
        type: "function_call_output",
        call_id: "c1",
        output: "shot\n[image omitted: provider cannot read images in tool results]",
      },
    ]);
  });
});
