import { describe, expect, it } from "vitest";
import { clearMessage } from "./clear-message";

describe("clearMessage", () => {
  it("strips a single ANSI color code", () => {
    const input = "\u001b[31mred text\u001b[0m";

    expect(clearMessage(input)).toBe("red text");
  });

  it("strips multiple chained ANSI codes", () => {
    const input = "\u001b[1m\u001b[31mbold red\u001b[0m and \u001b[32mgreen\u001b[0m";

    expect(clearMessage(input)).toBe("bold red and green");
  });

  it("leaves plain strings untouched", () => {
    expect(clearMessage("plain message")).toBe("plain message");
  });

  it("handles empty string", () => {
    expect(clearMessage("")).toBe("");
  });

  it("returns empty when input is only ANSI codes", () => {
    expect(clearMessage("\u001b[31m\u001b[0m")).toBe("");
  });

  it("returns non-string objects as-is", () => {
    const object = { foo: "bar" };

    expect(clearMessage(object)).toBe(object);
  });

  it("returns numbers as-is", () => {
    expect(clearMessage(42)).toBe(42);
  });

  it("returns null as-is", () => {
    expect(clearMessage(null)).toBeNull();
  });

  it("returns undefined as-is", () => {
    expect(clearMessage(undefined)).toBeUndefined();
  });

  it("returns Error instances as-is", () => {
    const error = new Error("boom");

    expect(clearMessage(error)).toBe(error);
  });
});
