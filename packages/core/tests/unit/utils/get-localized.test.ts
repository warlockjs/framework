import { describe, expect, it } from "vitest";
import { getLocalized, type LocalizedObject } from "../../../src/utils/get-localized";

const values: LocalizedObject[] = [
  { localeCode: "en", value: "Hello" },
  { localeCode: "ar", value: "مرحبا" },
];

describe("getLocalized", () => {
  it("returns the value for the requested locale", () => {
    expect(getLocalized(values, "en")).toBe("Hello");
    expect(getLocalized(values, "ar")).toBe("مرحبا");
  });

  it("returns undefined when no entry matches the locale", () => {
    expect(getLocalized(values, "fr")).toBeUndefined();
  });

  it("returns the input unchanged when it is falsy", () => {
    expect(getLocalized(null as never, "en")).toBeNull();
    expect(getLocalized(undefined as never, "en")).toBeUndefined();
  });

  it("reads a custom key instead of value", () => {
    const entries = [
      { localeCode: "en", value: "Hello", label: "English" },
      { localeCode: "ar", value: "مرحبا", label: "Arabic" },
    ] as unknown as LocalizedObject[];

    expect(getLocalized(entries, "ar", "label")).toBe("Arabic");
  });

  it("returns a non-array input as-is", () => {
    const notAnArray = { localeCode: "en", value: "Hello" } as unknown as LocalizedObject[];

    expect(getLocalized(notAnArray, "en")).toBe(notAnArray);
  });
});
