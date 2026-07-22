import { describe, expect, it } from "vitest";
import { makeSpan } from "../test-support/make-trace";
import { extractLastSystemPrompt } from "./extract-last-system-prompt";

describe("extractLastSystemPrompt", () => {
  it("returns undefined when input is absent (no content capture)", () => {
    const span = makeSpan({ spanId: "s1", traceId: "t1" });

    expect(extractLastSystemPrompt(span)).toBeUndefined();
  });

  it("returns undefined for a tool span (call args, not chat messages)", () => {
    const span = makeSpan({ spanId: "s1", traceId: "t1", input: { city: "Cairo" } });

    expect(extractLastSystemPrompt(span)).toBeUndefined();
  });

  it("extracts the system message from a [system, user] pair", () => {
    const span = makeSpan({
      spanId: "s1",
      traceId: "t1",
      input: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hi" },
      ],
    });

    expect(extractLastSystemPrompt(span)).toBe("Be concise.");
  });

  it("returns undefined when the agent carried no system prompt (bare user string)", () => {
    const span = makeSpan({ spanId: "s1", traceId: "t1", input: "Hi" });

    expect(extractLastSystemPrompt(span)).toBeUndefined();
  });

  it("returns the LAST system message under fullHistory (multiple system turns)", () => {
    const span = makeSpan({
      spanId: "s1",
      traceId: "t1",
      input: [
        { role: "system", content: "v1 instructions" },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "system", content: "v2 instructions" },
        { role: "user", content: "Bye" },
      ],
    });

    expect(extractLastSystemPrompt(span)).toBe("v2 instructions");
  });
});
