import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import type { Manifest } from "vite";
import { describe, expect, it, vi } from "vitest";
import { measureClientBudgets } from "./client-budget-report";

async function fixture(): Promise<Manifest> {
  return JSON.parse(
    await readFile(new URL("./fixtures/budget-manifest.json", import.meta.url), "utf8"),
  );
}
const asset = (file: string) => Buffer.from(`${file}\n${"export const value = 42;".repeat(100)}`);
const bytes = (files: string[]) =>
  files.reduce((sum, file) => sum + gzipSync(asset(file)).length, 0);
const pages = [
  { page: "/", source: "page.tsx", entry: "hydration", modules: ["page.tsx", "layout.tsx"] },
];
const chunks = {
  "assets/page.js": [
    { id: "page.tsx", bytes: 200 },
    { id: "feature.ts", bytes: 600 },
  ],
  "assets/layout.js": [{ id: "layout.tsx", bytes: 100 }],
};

describe("client budget manifest traversal", () => {
  it("includes hydration, page and layouts; deduplicates static diamonds, CSS and cycles", async () => {
    const readAsset = vi.fn(async (file: string) => asset(file));
    const report = await measureClientBudgets({
      manifest: await fixture(),
      chunks,
      pages,
      readAsset,
    });
    const page = report.pages[0];
    expect(page?.js).toBe(
      bytes([
        "assets/entry.js",
        "assets/vendor.js",
        "assets/shared.js",
        "assets/page.js",
        "assets/layout.js",
      ]),
    );
    expect(page?.css).toBe(bytes(["assets/page.css", "assets/shared.css"]));
    expect(page?.dynamic).toEqual({
      js: bytes(["assets/other.js", "assets/chart.js"]),
      css: bytes(["assets/other.css", "assets/chart.css"]),
    });
    expect(page?.modules[0]).toEqual({ id: "feature.ts", bytes: 600 });
    expect(readAsset.mock.calls.filter(([file]) => file === "assets/shared.css")).toHaveLength(1);
    expect(page?.js).toBeLessThan(asset("assets/entry.js").length);
  });

  it("fails closed on missing imports, hydration entries and page modules", async () => {
    const manifest = await fixture();
    delete manifest["_vendor.js"];
    await expect(
      measureClientBudgets({ manifest, chunks, pages, readAsset: async (file) => asset(file) }),
    ).rejects.toThrow("missing chunk");
    await expect(
      measureClientBudgets({ manifest: {}, chunks, pages, readAsset: async (file) => asset(file) }),
    ).rejects.toThrow("hydration entry");
    await expect(
      measureClientBudgets({
        manifest: await fixture(),
        chunks: {},
        pages,
        readAsset: async (file) => asset(file),
      }),
    ).rejects.toThrow("locate module");
  });

  it("counts setup register projections when bundled and skips empty ones the bundler dropped", async () => {
    const setup = "page.setup.ts?warlock-setup-register";
    const withRegister = await measureClientBudgets({
      manifest: await fixture(),
      chunks: {
        ...chunks,
        "assets/page.js": [...(chunks["assets/page.js"] ?? []), { id: setup, bytes: 50 }],
      },
      pages: [
        {
          page: "/",
          source: "page.tsx",
          entry: "hydration",
          modules: ["page.tsx", "layout.tsx"],
          optionalModules: [setup],
        },
      ],
      readAsset: async (file) => asset(file),
    });
    expect(withRegister.pages[0]?.modules).toContainEqual({ id: setup, bytes: 50 });
    const dropped = await measureClientBudgets({
      manifest: await fixture(),
      chunks,
      pages: [
        {
          page: "/",
          source: "page.tsx",
          entry: "hydration",
          modules: ["page.tsx", "layout.tsx"],
          optionalModules: [setup],
        },
      ],
      readAsset: async (file) => asset(file),
    });
    expect(dropped.pages[0]?.js).toBe(withRegister.pages[0]?.js);
  });

  it("uses only the selected site's hydration entry", async () => {
    const manifest = await fixture();
    manifest["site.ts"] = { name: "hydration-shop", isEntry: true, file: "assets/site.js" };
    const report = await measureClientBudgets({
      manifest,
      chunks: {},
      pages: [{ page: "/shop", source: "shop.tsx", entry: "hydration-shop", modules: [] }],
      readAsset: async (file) => asset(file),
    });
    expect(report.pages[0]?.files).toEqual(["assets/site.js"]);
  });
});
