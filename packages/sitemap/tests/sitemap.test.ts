import { mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InvalidBaseUrlError, InvalidSitemapEntryError } from "../src/errors";
import { Sitemap } from "../src/sitemap";

const baseUrl = "https://example.com";

describe("Sitemap — construction", () => {
  it("throws at the CONSTRUCTOR for a bad baseUrl, not at toXML()", () => {
    expect(() => new Sitemap({ baseUrl: "not-a-url" })).toThrow(InvalidBaseUrlError);
  });
});

describe("Sitemap — add", () => {
  it("requires only a path", () => {
    const sitemap = new Sitemap({ baseUrl }).add({ path: "/" });

    expect(sitemap.size).toBe(1);
    expect(sitemap.toXML()).toContain("<loc>https://example.com/</loc>");
  });

  it("chains", () => {
    const sitemap = new Sitemap({ baseUrl }).add({ path: "/a" }).add({ path: "/b" });

    expect(sitemap.size).toBe(2);
  });

  it("normalises a path missing its leading slash, so /a and a are ONE entry", () => {
    const sitemap = new Sitemap({ baseUrl }).add({ path: "about" }).add({ path: "/about" });

    expect(sitemap.size).toBe(1);
  });

  it("applies the builder defaults to an entry that omits them", () => {
    const xml = new Sitemap({ baseUrl, changefreq: "weekly", priority: 0.5 })
      .add({ path: "/a" })
      .toXML();

    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>0.5</priority>");
  });

  it("lets an entry override the defaults", () => {
    const xml = new Sitemap({ baseUrl, priority: 0.5 }).add({ path: "/a", priority: 0.9 }).toXML();

    expect(xml).toContain("<priority>0.9</priority>");
    expect(xml).not.toContain("<priority>0.5</priority>");
  });

  it("rejects a priority outside the protocol range", () => {
    expect(() => new Sitemap({ baseUrl }).add({ path: "/a", priority: 2 })).toThrow(
      InvalidSitemapEntryError,
    );
  });

  it("rejects a missing path rather than emitting an entry with no <loc>", () => {
    expect(() => new Sitemap({ baseUrl }).add({ path: "" })).toThrow(InvalidSitemapEntryError);
  });
});

describe("Sitemap — lastmod", () => {
  it("serialises a Date as W3C datetime", () => {
    const xml = new Sitemap({ baseUrl })
      .add({ path: "/a", lastmod: new Date("2026-09-17T10:00:00.000Z") })
      .toXML();

    expect(xml).toContain("<lastmod>2026-09-17T10:00:00.000Z</lastmod>");
  });

  it("passes a string through untouched rather than re-parsing it", () => {
    const xml = new Sitemap({ baseUrl }).add({ path: "/a", lastmod: "2026-09-17" }).toXML();

    expect(xml).toContain("<lastmod>2026-09-17</lastmod>");
  });

  it("rejects an invalid Date instead of emitting `Invalid Date`", () => {
    expect(() => new Sitemap({ baseUrl }).add({ path: "/a", lastmod: new Date("nope") })).toThrow(
      InvalidSitemapEntryError,
    );
  });
});

describe("Sitemap — duplicates", () => {
  it("keeps the LAST add for a repeated path, silently", () => {
    const sitemap = new Sitemap({ baseUrl })
      .add({ path: "/posts/1", priority: 0.1 })
      .add({ path: "/posts/1", priority: 0.9 });

    expect(sitemap.size).toBe(1);
    expect(sitemap.toXML()).toContain("<priority>0.9</priority>");
  });

  it("emits exactly one <loc> for a repeated path — a duplicate makes the document invalid", () => {
    const xml = new Sitemap({ baseUrl })
      .add({ path: "/posts/1" })
      .add({ path: "/posts/1" })
      .toXML();

    expect(xml.match(/<loc>/g)).toHaveLength(1);
  });

  it("reports the collision with every contributing route, so silent is not hidden", () => {
    const sitemap = new Sitemap({ baseUrl })
      .add({ path: "/posts/1", route: "/posts/:id" })
      .add({ path: "/posts/1", route: "/:slug" })
      .add({ path: "/posts/2", route: "/posts/:id" });

    expect(sitemap.duplicates()).toEqual([
      { path: "/posts/1", count: 2, routes: ["/posts/:id", "/:slug"] },
    ]);
  });

  it("reports nothing when there are no collisions", () => {
    expect(new Sitemap({ baseUrl }).add({ path: "/a" }).duplicates()).toEqual([]);
  });
});

describe("Sitemap — routes", () => {
  it("counts the URLs each route contributed", () => {
    const sitemap = new Sitemap({ baseUrl })
      .add({ path: "/posts/1", route: "/posts/:id" })
      .add({ path: "/posts/2", route: "/posts/:id" });

    expect(sitemap.routes()).toEqual([{ route: "/posts/:id", count: 2 }]);
  });

  // The whole reason declareRoute() exists: without it every known route has at
  // least one entry, a zero can never occur, and the diagnostic is decorative.
  it("reports a DECLARED route that contributed nothing as count 0", () => {
    const sitemap = new Sitemap({ baseUrl })
      .declareRoute("/products/:slug")
      .add({ path: "/posts/1", route: "/posts/:id" });

    expect(sitemap.routes()).toContainEqual({ route: "/products/:slug", count: 0 });
  });

  it("does not invent rows for entries with no route", () => {
    expect(new Sitemap({ baseUrl }).add({ path: "/a" }).routes()).toEqual([]);
  });

  it("does not print", () => {
    const logged: unknown[] = [];
    const original = console.warn;

    console.warn = (...args: unknown[]) => void logged.push(args);

    try {
      new Sitemap({ baseUrl }).declareRoute("/products/:slug").routes();
    } finally {
      console.warn = original;
    }

    expect(logged).toEqual([]);
  });
});

describe("Sitemap — alternates", () => {
  it("emits an xhtml:link per alternate and declares the namespace", () => {
    const xml = new Sitemap({ baseUrl })
      .add({
        path: "/en/about",
        alternates: [
          { hreflang: "en", path: "/en/about" },
          { hreflang: "ar", path: "/ar/من-نحن" },
          { hreflang: "x-default", path: "/en/about" },
        ],
      })
      .toXML();

    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/about"/>',
    );
    expect(xml).toContain('hreflang="x-default"');
  });

  it("omits the xhtml namespace entirely when nothing uses it", () => {
    const xml = new Sitemap({ baseUrl }).add({ path: "/about" }).toXML();

    expect(xml).not.toContain("xmlns:xhtml");
  });

  it("rejects an alternate with no hreflang", () => {
    expect(() =>
      new Sitemap({ baseUrl }).add({
        path: "/a",
        alternates: [{ hreflang: "", path: "/b" }],
      }),
    ).toThrow(InvalidSitemapEntryError);
  });
});

describe("Sitemap — toXML is pure", () => {
  it("returns the same string when called twice", () => {
    const sitemap = new Sitemap({ baseUrl }).add({ path: "/a" }).add({ path: "/b" });

    expect(sitemap.toXML()).toBe(sitemap.toXML());
  });

  it("does not drain the builder", () => {
    const sitemap = new Sitemap({ baseUrl }).add({ path: "/a" });

    sitemap.toXML();

    expect(sitemap.size).toBe(1);
    expect(sitemap.entries()).toHaveLength(1);
  });

  it("hands out a copy, so a caller mutating the array cannot corrupt the builder", () => {
    const sitemap = new Sitemap({ baseUrl }).add({ path: "/a" });
    const stolen = sitemap.entries() as unknown[];

    stolen.length = 0;

    expect(sitemap.entries()).toHaveLength(1);
  });
});

describe("Sitemap — saveTo", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes the document, creating parent directories that do not exist", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-sitemap-"));

    const filePath = join(dir, "nested", "deeper", "sitemap.xml");

    await new Sitemap({ baseUrl }).add({ path: "/a" }).saveTo(filePath);

    expect(await readFile(filePath, "utf8")).toContain("<loc>https://example.com/a</loc>");
  });

  it("replaces existing content byte-for-byte on a clean write", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-sitemap-"));

    const filePath = join(dir, "sitemap.xml");

    await writeFile(filePath, "<urlset><old/></urlset>", "utf8");

    const xml = new Sitemap({ baseUrl }).add({ path: "/a" }).toXML();

    await new Sitemap({ baseUrl }).add({ path: "/a" }).saveTo(filePath);

    expect(await readFile(filePath, "utf8")).toBe(xml);
  });

  it("leaves a pre-existing sitemap byte-for-byte untouched, and no temp file behind, when the publish fails mid-write", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-sitemap-"));

    const filePath = join(dir, "sitemap.xml");
    const original = "<urlset><untouched/></urlset>";

    await writeFile(filePath, original, "utf8");

    // Holding an open read handle on the target denies the delete-sharing rename needs
    // on Windows, so the publish's rename-over-target fails for real, every retry.
    const handle = await open(filePath, "r");

    try {
      await expect(new Sitemap({ baseUrl }).add({ path: "/a" }).saveTo(filePath)).rejects.toThrow();
    } finally {
      await handle.close();
    }

    expect(await readFile(filePath, "utf8")).toBe(original);
    expect(await readdir(dir)).toEqual(["sitemap.xml"]);
  });
});
