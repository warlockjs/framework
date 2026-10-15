import type { Plugin } from "esbuild";
import { describe, expect, it } from "vitest";
import { mergeEsbuildPatches } from "./build-contributions";

describe("mergeEsbuildPatches plugins", () => {
  it("concatenates plugins from both patches in contribution order", () => {
    const first: Plugin = { name: "first", setup() {} };
    const second: Plugin = { name: "second", setup() {} };

    const merged = mergeEsbuildPatches({ plugins: [first] }, { plugins: [second] });

    expect(merged.plugins).toEqual([first, second]);
  });

  it("keeps plugins from a patch that has none after it", () => {
    const first: Plugin = { name: "first", setup() {} };

    expect(mergeEsbuildPatches({ plugins: [first] }, { jsx: "automatic" }).plugins).toEqual([first]);
  });
});
