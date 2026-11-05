import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";

describe("known chat models (deepseek)", () => {
  it.each(["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-pro"])(
    "reports a positive window for %s",
    (name) => {
      expect(inferContextWindow(name)).toBeGreaterThan(0);
    },
  );

  it("leaves unknown ids unset", () => {
    expect(inferContextWindow("some-unlisted-model")).toBeUndefined();
  });
});
