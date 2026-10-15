import { describe, expect, it } from "vitest";
import {
  InvalidSitemapGenerationManifestError,
  parseSitemapGenerationManifest,
  parseSitemapManifestKey,
  sitemapManifestKey,
  sortSitemapManifestCandidates,
} from "../src/generation-manifest";

const digest = "a".repeat(64);
function manifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    fence: 7,
    generationId: "build_7",
    coversRev: 4,
    kind: "index",
    mainFile: "generations/build_7/sitemap_index.xml",
    files: [
      { path: "generations/build_7/sitemap_index.xml", bytes: 12, sha256: digest },
      { path: "generations/build_7/sitemap-1.xml", bytes: 10, sha256: digest },
    ],
    entries: 5,
    generatedAt: "2026-09-24T12:34:56.000Z",
    ...overrides,
  };
}

describe("generation manifest", () => {
  it("parses a complete immutable generation manifest", () => {
    expect(parseSitemapGenerationManifest(manifest())).toMatchObject({
      generationId: "build_7",
      mainFile: "generations/build_7/sitemap_index.xml",
    });
  });
  it.each([
    ["unsafe fence", { fence: -1 }],
    ["unsafe generation id", { generationId: "../escape" }],
    ["bad revision", { coversRev: 1.5 }],
    ["bad kind", { kind: "other" }],
    ["bad timestamp", { generatedAt: "not-a-date" }],
    ["main outside its generation", { mainFile: "generations/other/sitemap.xml" }],
    [
      "bad digest",
      { files: [{ path: "generations/build_7/a.xml", bytes: 1, sha256: "A".repeat(64) }] },
    ],
  ])("rejects %s", (_name, overrides) => {
    expect(() => parseSitemapGenerationManifest(manifest(overrides))).toThrow(
      InvalidSitemapGenerationManifestError,
    );
  });
  it("rejects duplicate paths, public names, and a main artifact that is absent", () => {
    const duplicate = { path: "generations/build_7/sitemap-1.xml", bytes: 1, sha256: digest };
    expect(() =>
      parseSitemapGenerationManifest(manifest({ files: [duplicate, duplicate] })),
    ).toThrow();
    expect(() =>
      parseSitemapGenerationManifest(manifest({ mainFile: "generations/build_7/missing.xml" })),
    ).toThrow();
  });
  it("uses fixed-width numeric fence keys and orders candidates by fence", () => {
    expect(sitemapManifestKey(12, "run-12")).toBe("manifests/0000000000000012-run-12.json");
    expect(parseSitemapManifestKey("manifests/0000000000000012-run-12.json")).toMatchObject({
      fence: 12,
    });
    expect(
      sortSitemapManifestCandidates([
        "noise.json",
        "manifests/0000000000000009-nine.json",
        "manifests/0000000000000010-ten.json",
      ]).map((candidate) => candidate.fence),
    ).toEqual([10, 9]);
  });
});
