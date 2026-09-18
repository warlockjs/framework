// Plain node, no deps beyond the package itself. Run with:
//   node scripts/measure-500k.mjs
//
// Generates 500,000 entries (each with 2 alternates) lazily — a generator,
// never a materialized array — and feeds them to SitemapIndex.saveTo(), so
// the only thing under measurement is the package's own shard-at-a-time
// writer, not an array this script built up front.
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";

// `src/` uses bundler-style extensionless relative imports
// (`moduleResolution: "Bundler"` in tsconfig.json). Plain node's ESM
// resolver needs the extension, so a small loader hook fills it in.
register("./ts-extension-resolve-hook.mjs", import.meta.url);

const { SitemapIndex } = await import("../src/index.ts");

const TOTAL_ENTRIES = 500_000;
const SAMPLE_INTERVAL_MS = 250;

function* generateEntries() {
  for (let i = 0; i < TOTAL_ENTRIES; i++) {
    yield {
      path: `/products/item-${i}`,
      alternates: [
        { hreflang: "en", path: `/en/products/item-${i}` },
        { hreflang: "ar", path: `/ar/products/item-${i}` },
      ],
    };
  }
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "warlock-sitemap-measure-500k-"));

  let peakRss = 0;
  const sample = () => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  };
  sample();
  const timer = setInterval(sample, SAMPLE_INTERVAL_MS);

  const index = new SitemapIndex({ baseUrl: "https://example.test" });
  index.addSource(() => generateEntries());

  const start = process.hrtime.bigint();
  const result = await index.saveTo(tempDir);
  const end = process.hrtime.bigint();

  clearInterval(timer);
  sample();

  const wallTimeMs = Number(end - start) / 1e6;

  console.log(
    JSON.stringify(
      {
        shardCount: result.files.length,
        totalUrls: result.totalUrls,
        totalBytes: result.files.reduce((sum, file) => sum + file.bytes, 0),
        wallTimeMs: Math.round(wallTimeMs),
        peakRssBytes: peakRss,
        peakRssMb: Math.round((peakRss / (1024 * 1024)) * 100) / 100,
      },
      null,
      2,
    ),
  );

  await rm(tempDir, { recursive: true, force: true });
}

main();
