import type { BaseReport, CapturedMessage, Usage } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import type { ContentRedactor } from "./content-capture.type";
import { reportToSpan } from "./report-to-span";

function usage(input: number, output: number): Usage {
  return { input, output, total: input + output };
}

/** An agent report carrying trips + an optional captured message array. */
function agentReport(
  overrides: Partial<BaseReport> & {
    trips?: Array<{ input?: unknown; output?: unknown }>;
    systemPrompt?: string;
    messages?: CapturedMessage[];
  } = {},
): BaseReport {
  return {
    runId: "run-1",
    rootRunId: "run-1",
    name: "agent",
    type: "agent",
    status: "completed",
    startedAt: "2026-06-22T10:00:00.000Z",
    endedAt: "2026-06-22T10:00:01.000Z",
    duration: 1000,
    usage: usage(100, 50),
    children: [],
    ...overrides,
  } as BaseReport;
}

const MESSAGES: CapturedMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "What's the weather?" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "c1", name: "weather", arguments: {} } as never],
  },
  { role: "tool", content: '{"temp":21}', toolCallId: "c1" },
  { role: "assistant", content: "It's 21 degrees." },
];

describe("reportToSpan — fullHistory capture (F2)", () => {
  it("puts the full CapturedMessage[] on span.input when fullHistory and messages present", () => {
    const report = agentReport({
      systemPrompt: "You are helpful.",
      trips: [
        { input: "What's the weather?", output: "" },
        { input: "[tool results]", output: "It's 21 degrees." },
      ],
      messages: MESSAGES,
    });

    const span = reportToSpan(report, { captureContent: true, fullHistory: true });

    expect(span.input).toEqual(MESSAGES);
    // Output stays the last non-empty trip output.
    expect(span.output).toBe("It's 21 degrees.");
  });

  it("falls back to first-trip [system,user] capture when messages absent", () => {
    const report = agentReport({
      systemPrompt: "You are helpful.",
      trips: [{ input: "What's the weather?", output: "It's 21 degrees." }],
      // no messages
    });

    const span = reportToSpan(report, { captureContent: true, fullHistory: true });

    expect(span.input).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "What's the weather?" },
    ]);
    expect(span.output).toBe("It's 21 degrees.");
  });

  it("does not use messages when fullHistory is off", () => {
    const report = agentReport({
      trips: [{ input: "hi", output: "hello" }],
      messages: MESSAGES,
    });

    const span = reportToSpan(report, { captureContent: true });

    expect(span.input).toBe("hi");
    expect(span.output).toBe("hello");
  });

  it("does not capture anything when captureContent is off, even with fullHistory", () => {
    const report = agentReport({ trips: [{ input: "hi", output: "hello" }], messages: MESSAGES });

    const span = reportToSpan(report, { fullHistory: true });

    expect(span.input).toBeUndefined();
    expect(span.output).toBeUndefined();
  });

  it("passes the full array through the redactor as a single value", () => {
    const redactContent: ContentRedactor = (value, { field }) =>
      field === "input" && Array.isArray(value)
        ? value.map(() => ({ role: "redacted", content: "***" }))
        : value;

    const report = agentReport({
      trips: [{ input: "q", output: "a" }],
      messages: MESSAGES,
    });

    const span = reportToSpan(report, { captureContent: true, fullHistory: true, redactContent });

    expect(span.input).toEqual(MESSAGES.map(() => ({ role: "redacted", content: "***" })));
  });

  it("drops span.input entirely when the redactor returns undefined for the array", () => {
    const redactContent: ContentRedactor = (_value, { field }) =>
      field === "input" ? undefined : _value;

    const report = agentReport({
      trips: [{ input: "q", output: "a" }],
      messages: MESSAGES,
    });

    const span = reportToSpan(report, { captureContent: true, fullHistory: true, redactContent });

    expect(span.input).toBeUndefined();
    expect(span.output).toBe("a");
  });

  it("falls back gracefully when fullHistory set but messages is an empty array", () => {
    const report = agentReport({
      trips: [{ input: "q", output: "a" }],
      messages: [],
    });

    const span = reportToSpan(report, { captureContent: true, fullHistory: true });

    expect(span.input).toBe("q");
    expect(span.output).toBe("a");
  });
});
