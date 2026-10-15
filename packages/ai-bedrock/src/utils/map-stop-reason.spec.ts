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

  it("maps tool_use to 'tool_calls'", () => {
    expect(mapStopReason("tool_use")).toBe("tool_calls");
  });

  it("treats filter / guardrail / malformed / context-overflow as 'error'", () => {
    expect(mapStopReason("content_filtered")).toBe("error");
    expect(mapStopReason("guardrail_intervened")).toBe("error");
    expect(mapStopReason("malformed_tool_use")).toBe("error");
    expect(mapStopReason("malformed_model_output")).toBe("error");
    expect(mapStopReason("model_context_window_exceeded")).toBe("error");
  });

  it("falls back to 'error' for null, undefined, empty, unknown", () => {
    expect(mapStopReason(null)).toBe("error");
    expect(mapStopReason(undefined)).toBe("error");
    expect(mapStopReason("")).toBe("error");
    expect(mapStopReason("future_reason")).toBe("error");
  });
});
