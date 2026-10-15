import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SitemapIndex } from "../src/sitemap-index";

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("SitemapIndex image shard accounting", () => {
  it("includes image markup and xmlns:image in the byte-accounted shard", async () => {
    directory = await mkdtemp(join(tmpdir(), "warlock-sitemap-images-"));
    const outputDir = join(directory, "sitemaps");
    const index = new SitemapIndex({
      baseUrl: "https://example.test",
      maxUrlsPerFile: 1_000,
      maxBytesPerFile: 1,
    }).addSource(() => [
      { path: "/products/one", images: [{ loc: "https://cdn.example.test/images/one.jpg" }] },
      { path: "/products/two", images: [{ loc: "https://cdn.example.test/images/two.jpg" }] },
    ]);

    const result = await index.saveTo(outputDir);

    expect(result.files).toHaveLength(2);
    expect(await readFile(result.files[0]!.path, "utf8")).toContain("xmlns:image");
  });
});
