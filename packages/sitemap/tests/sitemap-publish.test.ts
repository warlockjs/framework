import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UnownedOutputDirectoryError } from "../src/errors";
import { Sitemap } from "../src/sitemap";
import { SitemapIndex } from "../src/sitemap-index";

const baseUrl = "https://example.com";

let workDir: string;

afterEach(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

async function tempOutDir(): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), "sitemap-publish-"));

  return join(workDir, "sitemap");
}

describe("Sitemap.publishTo", () => {
  it("publishes the single file into a directory it owns", async () => {
    const outDir = await tempOutDir();

    const filePath = await new Sitemap({ baseUrl }).add({ path: "/" }).publishTo(outDir);

    expect(filePath).toBe(join(outDir, "sitemap.xml"));
    expect(await readFile(filePath, "utf8")).toContain("<loc>https://example.com/</loc>");
    expect((await readdir(outDir)).sort()).toEqual([".sitemap-set.json", "sitemap.xml"]);
  });

  it("lets a later index publish replace a single-file publish in the same directory", async () => {
    // A site that outgrows one file (or turns on per-locale files) publishes
    // an index into the directory its single file already lives in.
    const outDir = await tempOutDir();

    await new Sitemap({ baseUrl }).add({ path: "/" }).publishTo(outDir);

    const index = new SitemapIndex({ baseUrl }).addSource(() => [{ path: "/about" }]);

    await expect(index.saveTo(outDir)).resolves.toBeDefined();
  });

  it("lets a later single-file publish replace an index publish, leaving no stale shards", async () => {
    const outDir = await tempOutDir();

    await new SitemapIndex({ baseUrl }).addSource(() => [{ path: "/about" }]).saveTo(outDir);
    await new Sitemap({ baseUrl }).add({ path: "/" }).publishTo(outDir);

    expect((await readdir(outDir)).sort()).toEqual([".sitemap-set.json", "sitemap.xml"]);
  });

  it("uses the given file name", async () => {
    const outDir = await tempOutDir();

    const filePath = await new Sitemap({ baseUrl }).add({ path: "/" }).publishTo(outDir, "map.xml");

    expect(filePath).toBe(join(outDir, "map.xml"));
  });

  it("refuses a non-empty directory it did not create", async () => {
    const outDir = await tempOutDir();

    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "logo.png"), "not a sitemap");

    await expect(
      new Sitemap({ baseUrl }).add({ path: "/" }).publishTo(outDir),
    ).rejects.toBeInstanceOf(UnownedOutputDirectoryError);
  });
});
