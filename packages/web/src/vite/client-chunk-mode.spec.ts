import { describe, expect, it } from "vitest";
import {
  clientCodeSplitting,
  HYDRATION_CODE_SPLITTING,
  MERGED_CHUNK_MAX_SIZE,
  MERGED_CHUNK_MIN_SIZE,
  VENDOR_REACT_CHUNK_NAME,
} from "./build-client";
import { CLIENT_CHUNK_MODES, resolveClientChunkMode } from "./client-chunk-mode";

describe("resolveClientChunkMode", () => {
  it("defaults to split", () => {
    expect(resolveClientChunkMode(undefined)).toBe("split");
  });

  it.each(CLIENT_CHUNK_MODES)("accepts %s", (mode) => {
    expect(resolveClientChunkMode(mode)).toBe(mode);
  });

  it("rejects anything else with the accepted values in the message", () => {
    expect(() => resolveClientChunkMode("tiny")).toThrow(/"split", "merged" or "single"/);
    expect(() => resolveClientChunkMode(true)).toThrow(TypeError);
  });
});

describe("clientCodeSplitting", () => {
  it("keeps today's groups for split", () => {
    expect(clientCodeSplitting("split")).toBe(HYDRATION_CODE_SPLITTING);
  });

  it("turns code splitting off for single, which inlines dynamic imports", () => {
    expect(clientCodeSplitting("single")).toBe(false);
  });

  it("keeps the React vendor group and packs shared modules by size for merged", () => {
    const options = clientCodeSplitting("merged");

    if (options === false) throw new Error("merged must keep code splitting on");

    const [vendor, shared] = options.groups as Array<{
      name: string | ((id: string) => string | undefined);
      priority: number;
      minShareCount?: number;
      minSize?: number;
      maxSize?: number;
    }>;

    expect(typeof vendor!.name).toBe("function");
    expect(
      (vendor!.name as (id: string) => string | undefined)("/x/node_modules/react/index.js"),
    ).toBe(VENDOR_REACT_CHUNK_NAME);
    expect((vendor!.name as (id: string) => string | undefined)("/x/src/page.tsx")).toBeUndefined();
    expect(vendor!.priority).toBeGreaterThan(shared!.priority);
    expect(shared).toMatchObject({
      name: "shared",
      minShareCount: 2,
      minSize: MERGED_CHUNK_MIN_SIZE,
      maxSize: MERGED_CHUNK_MAX_SIZE,
    });
  });
});
