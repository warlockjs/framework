import { describe, expect, it } from "vitest";
import { mapStopReason } from "./map-stop-reason";

describe("mapStopReason", () => {
  it("maps natural stops to 'stop'", () => {
    expect(mapStopReason("end_turn")).toBe("stop");
    expect(mapStopReason("stop_sequence")).toBe("stop");
  });

  it("maps max_tokens to 'length'", () => {
    expect(mapStopReason("max_tokens")).toBe("length");
  });

  it("keeps model_context_window_exceeded distinct as 'context_exceeded'", () => {
    expect(mapStopReason("model_context_window_exceeded")).toBe("context_exceeded");
  });

  it("maps beta compaction to a clean 'stop'", () => {
    expect(mapStopReason("compaction")).toBe("stop");
  });

  it("maps tool_use to 'tool_calls'", () => {
    expect(mapStopReason("tool_use")).toBe("tool_calls");
  });

  it("keeps refusal and pause_turn distinct", () => {
    expect(mapStopReason("refusal")).toBe("refusal");
    expect(mapStopReason("pause_turn")).toBe("pause_turn");
  });

  it("falls back to 'error' for null, undefined, empty, and unknown values", () => {
    expect(mapStopReason(null)).toBe("error");
    expect(mapStopReason(undefined)).toBe("error");
    expect(mapStopReason("")).toBe("error");
    expect(mapStopReason("something-new")).toBe("error");
  });
});
