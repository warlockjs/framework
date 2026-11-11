import { describe, expect, it, vi } from "vitest";
import { collectSitemapEntries } from "./collect-sitemap-entries";
import type { SitemapSupplierContext } from "./sitemap-page-export";
import type { SitemapPageSource } from "./sitemap-page-source";

const noLocales = { codes: [] as string[] };

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });

  return { promise, resolve };
}

describe("collectSitemapEntries suppliers", () => {
  it("overlaps independent suppliers but keeps page order in the output", async () => {
    const gates = [deferred(), deferred(), deferred()];
    let running = 0;
    let maxRunning = 0;
    const supplier = (index: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await gates[index]!.promise;
      running--;
      return [{ path: `/item-${index}` }];
    };
    const pageSource: SitemapPageSource = () => [
      { routeName: "first", routePath: "/first/:id", sitemap: supplier(0) },
      { routeName: "about", routePath: "/about" },
      { routeName: "second", routePath: "/second/:id", sitemap: supplier(1) },
      { routeName: "third", routePath: "/third/:id", sitemap: supplier(2) },
    ];

    const collecting = collectSitemapEntries({ appRoot: "/app", locales: noLocales, pageSource });

    // Release in reverse order: the output must still follow the pages.
    await vi.waitFor(() => expect(running).toBe(3));
    gates[2]!.resolve();
    gates[1]!.resolve();
    gates[0]!.resolve();
    const { items } = await collecting;

    expect(maxRunning).toBe(3);
    expect(items.map((item) => item.entry.path)).toEqual([
      "/item-0",
      "/about",
      "/item-1",
      "/item-2",
    ]);
  });

  it("runs at most four suppliers at once", async () => {
    let running = 0;
    let maxRunning = 0;
    const pageSource: SitemapPageSource = () =>
      Array.from({ length: 10 }, (_, index) => ({
        routeName: `page-${index}`,
        routePath: `/page-${index}/:id`,
        sitemap: async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running--;
          return [{ path: `/page-${index}/x` }];
        },
      }));

    const { items } = await collectSitemapEntries({
      appRoot: "/app",
      locales: noLocales,
      pageSource,
    });

    expect(maxRunning).toBe(4);
    expect(items).toHaveLength(10);
  });

  it("reports the first failing supplier in page order", async () => {
    const pageSource: SitemapPageSource = () => [
      {
        routeName: "first",
        routePath: "/first/:id",
        sitemap: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error("first failed");
        },
      },
      {
        routeName: "second",
        routePath: "/second/:id",
        sitemap: async () => {
          throw new Error("second failed");
        },
      },
    ];

    await expect(
      collectSitemapEntries({ appRoot: "/app", locales: noLocales, pageSource }),
    ).rejects.toThrow("first failed");
  });

  it("passes the supplier context through, and an empty one when none is given", async () => {
    const seen: SitemapSupplierContext[] = [];
    const pageSource: SitemapPageSource = () => [
      {
        routeName: "listing",
        routePath: "/listings/:id",
        sitemap: (context: SitemapSupplierContext) => {
          seen.push(context);
          return [];
        },
      },
    ];

    await collectSitemapEntries({ appRoot: "/app", locales: noLocales, pageSource });
    await collectSitemapEntries({
      appRoot: "/app",
      locales: noLocales,
      pageSource,
      supplierContext: { site: "tenant", tenantKey: "acme" },
    });

    expect(seen).toEqual([{}, { site: "tenant", tenantKey: "acme" }]);
  });
});
