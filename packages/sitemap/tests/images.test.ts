import { describe, expect, it, vi } from "vitest";
import { InvalidSitemapEntryError } from "../src/errors";
import { Sitemap } from "../src/sitemap";

describe("Sitemap images", () => {
  it("keeps the first 1,000 images and reports one overflow per route", () => {
    const onImageLimitExceeded = vi.fn();
    const images = Array.from({ length: 1_002 }, (_, index) => ({
      loc: `https://cdn.example.test/${index}.jpg`,
    }));
    const sitemap = new Sitemap({ baseUrl: "https://example.test", onImageLimitExceeded });

    sitemap.add({ path: "/products/one", route: "/products/:slug", images });
    sitemap.add({ path: "/products/two", route: "/products/:slug", images });

    expect(sitemap.entries()[0]?.images).toHaveLength(1_000);
    expect(onImageLimitExceeded).toHaveBeenCalledTimes(1);
    expect(onImageLimitExceeded).toHaveBeenCalledWith({ route: "/products/:slug", dropped: 2 });
  });

  it("refuses a relative or non-HTTP image location", () => {
    const sitemap = new Sitemap({ baseUrl: "https://example.test" });

    expect(() => sitemap.add({ path: "/one", images: [{ loc: "/image.jpg" }] })).toThrow(
      InvalidSitemapEntryError,
    );
    expect(() =>
      sitemap.add({ path: "/two", images: [{ loc: "ftp://cdn.example.test/image.jpg" }] }),
    ).toThrow(InvalidSitemapEntryError);
  });
});
