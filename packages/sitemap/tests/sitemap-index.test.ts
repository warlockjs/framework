import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DuplicateSourceKeyError,
  InvalidBaseUrlError,
  UnownedOutputDirectoryError,
} from "../src/errors";
import { publishAtomically } from "../src/atomic-publish";
import { SitemapIndex } from "../src/sitemap-index";
import type { SitemapEntry } from "../src/types";

const baseUrl = "https://example.com";

let workDir: string;

afterEach(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

async function tempWorkDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), "sitemap-index-"));

  return workDir;
}

function factoryOf(entries: readonly SitemapEntry[]) {
  return () => entries;
}

async function readShard(outDir: string, fileName: string): Promise<string> {
  const raw = await readFile(join(outDir, fileName));

  return fileName.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
}

describe("SitemapIndex — construction", () => {
  it("validates baseUrl exactly as Sitemap does", () => {
    expect(() => new SitemapIndex({ baseUrl: "not-a-url" })).toThrow(InvalidBaseUrlError);
  });

  it("rejects a maxUrlsPerFile above the protocol ceiling", () => {
    expect(() => new SitemapIndex({ baseUrl, maxUrlsPerFile: 50_001 })).toThrow(RangeError);
  });

  it("rejects a maxBytesPerFile above the protocol ceiling", () => {
    expect(() => new SitemapIndex({ baseUrl, maxBytesPerFile: 50 * 1024 * 1024 + 1 })).toThrow(
      RangeError,
    );
  });
});

describe("SitemapIndex — addSource", () => {
  it("chains", () => {
    const index = new SitemapIndex({ baseUrl });

    expect(index.addSource(factoryOf([]))).toBe(index);
  });

  it("throws DuplicateSourceKeyError on an exact repeated key", () => {
    const index = new SitemapIndex({ baseUrl });

    index.addSource("en", factoryOf([]));

    expect(() => index.addSource("en", factoryOf([]))).toThrow(DuplicateSourceKeyError);
  });

  it("throws DuplicateSourceKeyError on a case collision", () => {
    const index = new SitemapIndex({ baseUrl });

    index.addSource("en-US", factoryOf([]));

    expect(() => index.addSource("en-us", factoryOf([]))).toThrow(DuplicateSourceKeyError);
  });

  it("has no entries(), toXML() or size — it retains nothing", () => {
    const index = new SitemapIndex({ baseUrl }) as unknown as Record<string, unknown>;

    expect(index.entries).toBeUndefined();
    expect(index.toXML).toBeUndefined();
    expect(index.size).toBeUndefined();
  });
});

describe("SitemapIndex — saveTo, single shard", () => {
  it("writes one shard and an index for a small unnamed source", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");
    const index = new SitemapIndex({ baseUrl }).addSource(
      factoryOf([{ path: "/a" }, { path: "/b" }]),
    );

    const result = await index.saveTo(outDir);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.urls).toBe(2);
    expect(result.files[0]?.path).toBe(join(outDir, "sitemap-0001.xml"));
    expect(result.totalUrls).toBe(2);
    expect(result.indexPath).toBe(join(outDir, "sitemap_index.xml"));

    const shardXml = await readFile(result.files[0]!.path, "utf8");

    expect(shardXml).toContain("<loc>https://example.com/a</loc>");
    expect(shardXml).toContain("<loc>https://example.com/b</loc>");

    const indexXml = await readFile(result.indexPath, "utf8");

    expect(indexXml).toContain("<loc>https://example.com/sitemap-0001.xml</loc>");
  });
});

describe("SitemapIndex — sharding on maxUrlsPerFile", () => {
  it("rolls to a new shard the moment the URL ceiling is hit, and never renames the first shard", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");
    const entries = Array.from({ length: 7 }, (_, i) => ({ path: `/item-${i}` }));
    const index = new SitemapIndex({ baseUrl, maxUrlsPerFile: 3 }).addSource(factoryOf(entries));

    const result = await index.saveTo(outDir);

    expect(result.files.map((f) => f.urls)).toEqual([3, 3, 1]);
    expect(result.files.map((f) => f.path)).toEqual([
      join(outDir, "sitemap-0001.xml"),
      join(outDir, "sitemap-0002.xml"),
      join(outDir, "sitemap-0003.xml"),
    ]);
    expect(result.totalUrls).toBe(7);
  });
});

describe("SitemapIndex — sharding on maxBytesPerFile", () => {
  it("rolls on the byte ceiling even when the URL ceiling has not been hit", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");
    // Every entry serialises to roughly the same size; a tiny byte ceiling forces
    // a roll well before the (generous) URL ceiling would.
    const entries = Array.from({ length: 5 }, (_, i) => ({ path: `/long-path-name-${i}` }));
    const index = new SitemapIndex({
      baseUrl,
      maxUrlsPerFile: 1000,
      maxBytesPerFile: 260,
    }).addSource(factoryOf(entries));

    const result = await index.saveTo(outDir);

    expect(result.files.length).toBeGreaterThan(1);
    expect(result.totalUrls).toBe(5);
  });
});

describe("SitemapIndex — gzip", () => {
  it("writes .xml.gz shards and points the index at them", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");
    const index = new SitemapIndex({ baseUrl, gzip: true }).addSource(factoryOf([{ path: "/a" }]));

    const result = await index.saveTo(outDir);

    expect(result.files[0]?.path.endsWith(".xml.gz")).toBe(true);
    expect(result.files[0]?.gzipped).toBe(true);

    const shardXml = await readShard(outDir, "sitemap-0001.xml.gz");

    expect(shardXml).toContain("<loc>https://example.com/a</loc>");

    const indexXml = await readFile(result.indexPath, "utf8");

    expect(indexXml).toContain("<loc>https://example.com/sitemap-0001.xml.gz</loc>");
  });
});

describe("SitemapIndex — named sources and the flat master index", () => {
  it("names shard files with the key, keeps the index flat and key-then-ordinal ordered", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");
    const index = new SitemapIndex({ baseUrl, maxUrlsPerFile: 2 })
      .addSource("en", factoryOf([{ path: "/en/a" }, { path: "/en/b" }, { path: "/en/c" }]))
      .addSource("ar", factoryOf([{ path: "/ar/a" }]));

    const result = await index.saveTo(outDir);

    expect(result.files.map((f) => f.path)).toEqual([
      join(outDir, "sitemap-en-0001.xml"),
      join(outDir, "sitemap-en-0002.xml"),
      join(outDir, "sitemap-ar-0001.xml"),
    ]);
    expect(result.files.map((f) => f.key)).toEqual(["en", "en", "ar"]);

    const indexXml = await readFile(result.indexPath, "utf8");
    const enIndex = indexXml.indexOf("sitemap-en-0001.xml");
    const enIndex2 = indexXml.indexOf("sitemap-en-0002.xml");
    const arIndex = indexXml.indexOf("sitemap-ar-0001.xml");

    // No nested per-locale index: one flat list, in registration/ordinal order.
    expect(enIndex).toBeGreaterThanOrEqual(0);
    expect(enIndex2).toBeGreaterThan(enIndex);
    expect(arIndex).toBeGreaterThan(enIndex2);
    expect((indexXml.match(/<sitemapindex/g) ?? []).length).toBe(1);
  });

  it("reports an empty group as a zero-url row, never as a written shard", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");
    const index = new SitemapIndex({ baseUrl }).addSource("empty", factoryOf([]));

    const result = await index.saveTo(outDir);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.urls).toBe(0);
    expect(result.files[0]?.key).toBe("empty");

    const dirEntries = await readdir(outDir);

    expect(dirEntries).not.toContain("sitemap-empty-0001.xml");

    const indexXml = await readFile(result.indexPath, "utf8");

    expect(indexXml).not.toContain("sitemap-empty-0001.xml");
  });
});

describe("SitemapIndex — alternates", () => {
  it("declares the xhtml namespace only on a shard whose own entries carry alternates", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");
    const index = new SitemapIndex({ baseUrl, maxUrlsPerFile: 1 })
      .addSource(
        "en",
        factoryOf([{ path: "/en/a", alternates: [{ hreflang: "en", path: "/en/a" }] }]),
      )
      .addSource("plain", factoryOf([{ path: "/plain/a" }]));

    const result = await index.saveTo(outDir);

    const enShard = result.files.find((f) => f.key === "en")!;
    const plainShard = result.files.find((f) => f.key === "plain")!;

    const enXml = await readFile(enShard.path, "utf8");
    const plainXml = await readFile(plainShard.path, "utf8");

    expect(enXml).toContain("xmlns:xhtml");
    expect(plainXml).not.toContain("xmlns:xhtml");
  });

  it("rolls a shard on the byte ceiling accounting for xhtml:link bytes, not just <loc>", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");
    const entries = Array.from({ length: 3 }, (_, i) => ({
      path: `/item-${i}`,
      alternates: [
        { hreflang: "en", path: `/en/item-${i}` },
        { hreflang: "ar", path: `/ar/item-${i}` },
      ],
    }));

    // A ceiling that fits one entry-with-alternates comfortably but not two —
    // it would look generous if the ceiling check ignored the <xhtml:link> bytes.
    const index = new SitemapIndex({
      baseUrl,
      maxUrlsPerFile: 1000,
      maxBytesPerFile: 420,
    }).addSource(factoryOf(entries));

    const result = await index.saveTo(outDir);

    expect(result.files.length).toBeGreaterThan(1);

    for (const file of result.files) {
      const xml = await readFile(file.path, "utf8");

      expect(Buffer.byteLength(xml, "utf8")).toBeLessThanOrEqual(420);
    }
  });
});

describe("SitemapIndex — duplicates", () => {
  it("skips a duplicate path (the earlier one is already on disk) and reports it", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");
    const index = new SitemapIndex({ baseUrl }).addSource(
      factoryOf([
        { path: "/a", route: "/a-route" },
        { path: "/a", route: "/a-route-again" },
        { path: "/b" },
      ]),
    );

    const result = await index.saveTo(outDir);

    expect(result.totalUrls).toBe(2);
    expect(result.duplicates).toEqual([
      { path: "/a", count: 2, routes: ["/a-route", "/a-route-again"] },
    ]);

    const shardXml = await readFile(result.files[0]!.path, "utf8");

    expect((shardXml.match(/<loc>https:\/\/example\.com\/a<\/loc>/g) ?? []).length).toBe(1);
  });
});

describe("SitemapIndex — retry via factory", () => {
  it("calls the factory again on a second saveTo(), rather than draining a bare iterable", async () => {
    let calls = 0;
    const factory = () => {
      calls += 1;

      return [{ path: "/a" }];
    };

    const index = new SitemapIndex({ baseUrl }).addSource(factory);

    const outDir1 = join(await tempWorkDir(), "run-1");

    await index.saveTo(outDir1);

    const outDir2 = join(workDir, "run-2");

    const result = await index.saveTo(outDir2);

    expect(calls).toBe(2);
    expect(result.totalUrls).toBe(1);
  });
});

describe("SitemapIndex — atomic publish", () => {
  it("leaves a previous complete set untouched when a run fails", async () => {
    const root = await tempWorkDir();
    const outDir = join(root, "sitemaps");

    const good = new SitemapIndex({ baseUrl }).addSource(factoryOf([{ path: "/a" }]));

    await good.saveTo(outDir);

    const previousXml = await readFile(join(outDir, "sitemap_index.xml"), "utf8");

    async function* failingSource() {
      yield { path: "/b" };
      throw new Error("simulated failure mid-walk");
    }

    const failing = new SitemapIndex({ baseUrl }).addSource(() => failingSource());

    await expect(failing.saveTo(outDir)).rejects.toThrow("simulated failure mid-walk");

    const stillThere = await readFile(join(outDir, "sitemap_index.xml"), "utf8");

    expect(stillThere).toBe(previousXml);

    const dirEntries = await readdir(root);

    // No leftover temp/previous directories beside outDir.
    expect(dirEntries).toEqual(["sitemaps"]);
  });

  it("refuses to publish a set whose index names a shard that was never written", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");

    await expect(
      publishAtomically(outDir, async () => {
        // Names a shard in the result without writing it — exactly the defect the validation guards against.
        return ["sitemap-0001.xml"];
      }),
    ).rejects.toThrow(/missing or empty/);

    const outDirExists = await readdir(join(outDir, "..")).catch(() => []);

    expect(outDirExists).not.toContain("sitemaps");
  });

  it("refuses to publish a set that names an empty shard file", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");

    await expect(
      publishAtomically(outDir, async (tempDir) => {
        await writeFile(join(tempDir, "sitemap-0001.xml"), "");

        return ["sitemap-0001.xml"];
      }),
    ).rejects.toThrow(/missing or empty/);
  });
});

describe("SitemapIndex — unowned output directory (de97020e)", () => {
  it("refuses to swap a non-empty outDir that carries no ownership marker, leaving it untouched", async () => {
    const outDir = join(await tempWorkDir(), "public");

    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "favicon.ico"), "not a sitemap");

    const index = new SitemapIndex({ baseUrl }).addSource(factoryOf([{ path: "/a" }]));

    await expect(index.saveTo(outDir)).rejects.toThrow(UnownedOutputDirectoryError);

    const dirEntries = await readdir(outDir);

    expect(dirEntries).toEqual(["favicon.ico"]);
  });

  it("creates outDir with an ownership marker on first publish, and reuses it on the next", async () => {
    const outDir = join(await tempWorkDir(), "sitemaps");

    const first = new SitemapIndex({ baseUrl, maxUrlsPerFile: 2 }).addSource(
      factoryOf([{ path: "/a" }, { path: "/b" }, { path: "/c" }]),
    );

    await first.saveTo(outDir);

    const afterFirst = await readdir(outDir);

    expect(afterFirst).toContain(".sitemap-set.json");
    expect(afterFirst.filter((name) => name.startsWith("sitemap-"))).toHaveLength(2);

    const second = new SitemapIndex({ baseUrl }).addSource(factoryOf([{ path: "/only" }]));

    await second.saveTo(outDir);

    const afterSecond = await readdir(outDir);

    expect(afterSecond).toContain(".sitemap-set.json");
    // A different shard count than the first run: no stale shard from the
    // earlier, larger set survives the swap.
    expect(afterSecond.filter((name) => name.startsWith("sitemap-"))).toEqual(["sitemap-0001.xml"]);
  });
});
