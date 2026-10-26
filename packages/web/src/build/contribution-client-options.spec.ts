import { describe, expect, it } from "vitest";
import { createWebBuildContribution } from "./contribution";

describe("web build options chunks and precompress", () => {
  it("accepts every chunk mode and both precompress values", () => {
    for (const chunks of ["split", "merged", "single"] as const) {
      for (const precompress of [true, false]) {
        expect(() => createWebBuildContribution({ chunks, precompress })).not.toThrow();
      }
    }
  });

  it("accepts neither option set", () => {
    expect(() => createWebBuildContribution({})).not.toThrow();
  });

  it("rejects an unknown chunk mode when the config is read", () => {
    expect(() => createWebBuildContribution({ chunks: "huge" as never })).toThrow(
      /Invalid web build option chunks/,
    );
  });

  it("rejects a precompress that is not a boolean", () => {
    expect(() => createWebBuildContribution({ precompress: "no" as never })).toThrow(
      /Invalid web build option precompress/,
    );
  });
});
