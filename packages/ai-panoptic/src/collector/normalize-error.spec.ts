import { describe, expect, it } from "vitest";
import { normalizeError } from "./normalize-error";

describe("normalizeError", () => {
  it("returns undefined for absent errors", () => {
    expect(normalizeError(undefined)).toBeUndefined();
    expect(normalizeError(null)).toBeUndefined();
  });

  it("prefers the stable error code over the class name", () => {
    const error = Object.assign(new Error("boom"), { code: "PROVIDER_TIMEOUT" });

    const normalized = normalizeError(error);

    expect(normalized?.type).toBe("PROVIDER_TIMEOUT");
    expect(normalized?.message).toBe("boom");
  });

  it("falls back to the error name when no code is present", () => {
    const error = new TypeError("bad call");

    const normalized = normalizeError(error);

    expect(normalized?.type).toBe("TypeError");
    expect(normalized?.message).toBe("bad call");
    expect(normalized?.stack).toBeDefined();
  });

  it("stringifies a thrown non-object value", () => {
    const normalized = normalizeError("plain string failure");

    expect(normalized).toEqual({
      type: "Error",
      message: "plain string failure",
    });
  });

  it("defaults type to Error when neither code nor name is usable", () => {
    const normalized = normalizeError({ message: "no name no code" });

    expect(normalized?.type).toBe("Error");
    expect(normalized?.message).toBe("no name no code");
    expect(normalized?.stack).toBeUndefined();
  });
});
