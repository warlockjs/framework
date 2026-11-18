/**
 * The static export's product map: its answers, its inlined module and its
 * screenshots. The rest of the export is covered in `tests/devtools.spec.ts`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { openGrimoire } from "../workspace";
import {
  buildSiteData,
  collectScreenshotPaths,
  copyScreenshots,
  exportGrimoireSite,
  inlineProductMap,
  renderSiteHtml,
} from "./site";

vi.mock("./product-map", () => ({
  productMap: () => ({ features: [], apps: [], builtAt: "now", developer: true }),
  productFeature: (_snapshot: unknown, id: string) => ({ feature: { id } }),
  productFlow: (_snapshot: unknown, feature: string, flow: string) => ({ flow: { ref: `${feature}/${flow}` } }),
}));

vi.mock("./data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data")>()),
  flowAnswer: (_snapshot: unknown, feature: string, flow: string) => ({ compact: `${feature}/${flow}` }),
  checkGroups: () => ({ groups: [] }),
}));

const folders: string[] = [];
let copy: FixtureCopy | null = null;

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  copy?.remove();
  copy = null;
});

const temp = (): string => {
  const folder = mkdtempSync(path.join(tmpdir(), "grimoire-site-"));

  folders.push(folder);

  return folder;
};

const screenshot = (file: string | null) => ({
  alt: "x",
  written: String(file),
  path: file,
  at: { file: "grimoire/x.md", line: 1, column: null },
});

describe("collectScreenshotPaths", () => {
  it("finds every screenshot path once, skipping paths that point elsewhere", () => {
    const found = collectScreenshotPaths({
      features: [{ flows: [{ story: [{ screenshots: [screenshot("a.png"), screenshot("a.png")] }] }] }],
      apps: [{ pages: [{ screenshots: [screenshot("web/b.png"), screenshot(null)] }] }],
    });

    expect(found).toEqual(["a.png", "web/b.png"]);
  });
});

describe("copyScreenshots", () => {
  it("copies images inside the folder and skips paths outside, odd extensions, links out and missing files", async () => {
    const root = temp();
    const out = temp();
    const folder = path.join(root, "grimoire", "screenshots");

    mkdirSync(path.join(folder, "web"), { recursive: true });
    writeFileSync(path.join(folder, "web", "home.png"), "png");
    writeFileSync(path.join(folder, "icon.svg"), "<svg/>");
    writeFileSync(path.join(root, "secret.png"), "secret");
    symlinkSync(path.join(root, "secret.png"), path.join(folder, "link.png"));

    const copied = await copyScreenshots(root, out, [
      "web/home.png",
      "../../secret.png",
      "../secret.png",
      "/etc/passwd",
      "icon.svg",
      "link.png",
      "missing.png",
      "web\\home.png",
    ]);

    expect(copied).toEqual(["web/home.png"]);
    expect(readFileSync(path.join(out, "screenshots", "web", "home.png"), "utf8")).toBe("png");
    expect(existsSync(path.join(out, "secret.png"))).toBe(false);
    expect(existsSync(path.join(out, "screenshots", "icon.svg"))).toBe(false);
    expect(existsSync(path.join(out, "screenshots", "link.png"))).toBe(false);
  });

  it("does nothing when the project has no screenshots folder", async () => {
    expect(await copyScreenshots(temp(), temp(), ["a.png"])).toEqual([]);
  });
});

describe("the product map in the page", () => {
  it("inlines the module without its exports and registers it for the view", () => {
    const code = inlineProductMap(
      "export async function productMapView() {}\nasync function renderProductMap() {}\n\nexport default renderProductMap;\n",
    );

    expect(code).toContain("async function productMapView()");
    expect(code).not.toContain("export");
    expect(code).toContain("globalThis.grimoireProductMap = { productMapView };");
    expect(() => inlineProductMap("export function x() {}")).toThrow("export default renderProductMap");
  });

  it("puts the module and its styles into the page before the view", () => {
    const html = renderSiteHtml(
      { routes: {}, files: {}, search: [] },
      {
        view: "async function renderGrimoire() {}\nexport default renderGrimoire;",
        loader: "",
        css: "",
        productMap: "export async function productMapView() {}\nexport default renderProductMap;",
        productCss: ".pm-root{color:red}",
      },
    );

    expect(html).toContain(".pm-root{color:red}");
    expect(html.indexOf("globalThis.grimoireProductMap")).toBeLessThan(html.indexOf("async function renderGrimoire"));
  });
});

describe("the export", () => {
  it("holds the product answers, the compact flow answers, the check groups and the screenshots", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();

    await openGrimoire(copy.root, adapter, { routes: "fresh" });
    mkdirSync(path.join(copy.root, "grimoire", "screenshots", "web"), { recursive: true });
    writeFileSync(path.join(copy.root, "grimoire", "screenshots", "web", "home.png"), "png");
    writeFileSync(path.join(copy.root, "outside.png"), "no");

    const { createSnapshotSource } = await import("./snapshot-source");
    const opened = await createSnapshotSource(copy.root, { adapter }).get();
    const snapshot = {
      ...opened,
      written: {
        ...opened.written,
        extra: [screenshot("web/home.png"), screenshot("../../outside.png")],
      },
    } as typeof opened;
    const site = buildSiteData(snapshot);
    const feature = snapshot.written.features[0];
    const flow = feature?.flows[0];

    expect(site.routes.product).toBeDefined();
    expect(site.routes["check/groups"]).toEqual({ groups: [] });
    expect(site.routes[`product/features/${feature?.id}`]).toEqual({ feature: { id: feature?.id } });
    expect(site.routes[`product/flows/${flow?.ref}`]).toBeDefined();
    expect(site.routes[`flows/${flow?.ref}`]).toEqual({ compact: flow?.ref });

    const out = await exportGrimoireSite(copy.root, { snapshot, outDir: "out/site" });

    expect(readFileSync(path.join(copy.root, out, "screenshots", "web", "home.png"), "utf8")).toBe("png");
    expect(existsSync(path.join(copy.root, out, "outside.png"))).toBe(false);
    expect(existsSync(path.join(copy.root, out, "screenshots", "outside.png"))).toBe(false);
    expect(readFileSync(path.join(copy.root, out, "index.html"), "utf8")).toContain("grimoireProductMap");
  });
});
