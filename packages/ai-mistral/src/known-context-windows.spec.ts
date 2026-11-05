import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";

describe("known chat models (mistral)", () => {
  it.each([
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
    "ministral-14b-latest",
    "codestral-latest",
    "pixtral-large-latest",
    "pixtral-12b",
    "magistral-medium-latest",
    "magistral-small-latest",
  ])("reports a positive window for %s", (name) => {
    expect(inferContextWindow(name)).toBeGreaterThan(0);
  });

  it("leaves unknown ids unset", () => {
    expect(inferContextWindow("some-unlisted-model")).toBeUndefined();
  });
});
