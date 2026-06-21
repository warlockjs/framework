import { describe, expect, it } from "vitest";
import { mapDoneReason } from "./map-done-reason";

describe("mapDoneReason", () => {
  it("maps stop to 'stop' and length to 'length'", () => {
    expect(mapDoneReason("stop")).toBe("stop");
    expect(mapDoneReason("length")).toBe("length");
  });

  it("maps load and unknown reasons to 'error'", () => {
    expect(mapDoneReason("load")).toBe("error");
    expect(mapDoneReason("something")).toBe("error");
  });

  it("falls back to 'error' for null / undefined / empty", () => {
    expect(mapDoneReason(null)).toBe("error");
    expect(mapDoneReason(undefined)).toBe("error");
    expect(mapDoneReason("")).toBe("error");
  });
});
