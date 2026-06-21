import { describe, expect, it } from "vitest";
import { mapFinishReason } from "./map-finish-reason";

describe("mapFinishReason", () => {
  it("maps STOP to 'stop' and MAX_TOKENS to 'length'", () => {
    expect(mapFinishReason("STOP")).toBe("stop");
    expect(mapFinishReason("MAX_TOKENS")).toBe("length");
  });

  it("maps safety / recitation / malformed reasons to 'error'", () => {
    expect(mapFinishReason("SAFETY")).toBe("error");
    expect(mapFinishReason("RECITATION")).toBe("error");
    expect(mapFinishReason("BLOCKLIST")).toBe("error");
    expect(mapFinishReason("PROHIBITED_CONTENT")).toBe("error");
    expect(mapFinishReason("MALFORMED_FUNCTION_CALL")).toBe("error");
  });

  it("falls back to 'error' for unspecified / null / undefined / unknown", () => {
    expect(mapFinishReason("FINISH_REASON_UNSPECIFIED")).toBe("error");
    expect(mapFinishReason(null)).toBe("error");
    expect(mapFinishReason(undefined)).toBe("error");
    expect(mapFinishReason("")).toBe("error");
    expect(mapFinishReason("SOMETHING_NEW")).toBe("error");
  });
});
