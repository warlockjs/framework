import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTranslationManifest, resolveSharedGroups } from "./translation-manifest";
import { writeTranslationAssets } from "./emit-translation-assets";
import type { DiscoveredPage, DiscoveredRoutablePage } from "./discover-pages";
import { CLIENT_ASSET_URL_PREFIX } from "../server/client-asset-url-prefix";
import { productionAssetsDirectoryOptions } from "../server/web-connector";
import { assetUrlFor } from "../translations/delivery";

let root: string;
let srcRoot: string;

function write(file: string, text: string): string {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text, "utf8");
  return absolute;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-translation-manifest-"));
  srcRoot = path.join(root, "src");

  write(
    "src/web/locales.json",
    JSON.stringify({
      $group: "app",
      title: { en: "Orders", ar: "الطلبات" },
    }),
  );
  write(
    "src/web/orders/locales.json",
    JSON.stringify({
      statuses: { paid: { en: "Paid", ar: "مدفوع" }, open: { en: "Open", ar: "مفتوح" } },
    }),
  );
  write("src/web/members/locales.json", JSON.stringify({ title: { en: "Members", ar: "الأعضاء" } }));
  write("src/web/layout.tsx", `export default function Layout() { return trans("app.title"); }`);
  write("src/web/root.tsx", `export default function Root() { return null; }`);
  write(
    "src/web/orders/index.page.tsx",
    "export default function Orders({ order }) { return <p>{trans(`statuses.${order.status}`)}</p>; }",
  );
  write("src/web/orders/index.setup.ts", `export const config = { translations: ["members"] };`);
  write(
    "src/web/members/index.page.tsx",
    `export default function M() { return <p>{trans("members.title")}</p>; }`,
  );
  write(
    "src/web/error.page.tsx",
    `export default function E() { return <p>{trans("common.error")}</p>; }`,
  );
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function routable(
  pageFile: string,
  extra: Partial<DiscoveredRoutablePage> = {},
): DiscoveredRoutablePage {
  return {
    type: "page",
    routeName: path.basename(pageFile),
    routePath: "/x",
    pageFile,
    webRoot: path.join(srcRoot, "web"),
    layouts: [path.join(srcRoot, "web/layout.tsx")],
    middlewareLayouts: [],
    appFile: path.join(srcRoot, "web/root.tsx"),
    ...extra,
  };
}

function input(options?: Parameters<typeof buildTranslationManifest>[0]["options"]) {
  const pages: DiscoveredPage[] = [
    routable(path.join(srcRoot, "web/orders/index.page.tsx"), {
      routeName: "orders",
      setupFile: path.join(srcRoot, "web/orders/index.setup.ts"),
    }),
    routable(path.join(srcRoot, "web/members/index.page.tsx"), { routeName: "members" }),
    {
      type: "error" as const,
      pageFile: path.join(srcRoot, "web/error.page.tsx"),
      webRoot: path.join(srcRoot, "web"),
    },
  ];

  return {
    srcRoot,
    pages,
    localeFiles: [
      { sourceFile: path.join(srcRoot, "web/locales.json"), webRoot: path.join(srcRoot, "web") },
      {
        sourceFile: path.join(srcRoot, "web/orders/locales.json"),
        webRoot: path.join(srcRoot, "web"),
      },
      {
        sourceFile: path.join(srcRoot, "web/members/locales.json"),
        webRoot: path.join(srcRoot, "web"),
      },
    ],
    relativeTo: (file: string) => path.relative(root, file).split(path.sep).join("/"),
    options,
  };
}

describe("buildTranslationManifest", () => {
  it("records each page's usage under its app-root-relative identity", () => {
    const { manifest } = buildTranslationManifest(input());
    const orders = manifest.usage["src/web/orders/index.page.tsx"];

    expect(orders).toBeDefined();
    expect(orders?.dynamic).toBe(false);
    expect(orders?.prefixes).toEqual(["statuses."]);
    expect(orders?.keys).toEqual(expect.arrayContaining(["app.title", "members"]));
  });

  it("reaches a literal key in a page that does not use a prefix", () => {
    const { manifest } = buildTranslationManifest(input());

    expect(manifest.usage["src/web/members/index.page.tsx"]?.keys).toEqual(
      expect.arrayContaining(["members.title"]),
    );
  });

  it("records each page's usage again under its route name, for the global-registry mode", () => {
    const { manifest } = buildTranslationManifest(input());

    expect(manifest.routes?.orders?.prefixes).toEqual(["statuses."]);
    expect(manifest.routes?.members?.keys).toEqual(expect.arrayContaining(["members.title"]));
  });

  it("records error pages as their own entries", () => {
    const { manifest } = buildTranslationManifest(input());

    expect(manifest.usage["src/web/error.page.tsx"]?.keys).toEqual(
      expect.arrayContaining(["common.error"]),
    );
  });

  it("marks every page dynamic when pruning is off, so every page ships the full groups", () => {
    const { manifest } = buildTranslationManifest(input({ prune: false }));

    expect(manifest.prune).toBe(false);
    expect(Object.values(manifest.usage).every((usage) => usage.dynamic)).toBe(true);
  });

  it("emits one hashed shared table per locale, in the translations directory", () => {
    const { assets } = buildTranslationManifest(input());

    expect(assets.map((asset) => asset.locale).sort()).toEqual(["ar", "en"]);
    for (const asset of assets) {
      expect(asset.fileName).toMatch(/^translations\/(ar|en)\.[0-9a-f]{16}\.json$/);
      expect(JSON.parse(asset.body)).toEqual({ app: { title: expect.any(String) } });
    }
  });

  it("uses the shared groups the options name", () => {
    const { manifest, assets } = buildTranslationManifest(input({ sharedGroups: ["members"] }));

    expect(manifest.sharedGroups).toEqual(["members"]);
    expect(JSON.parse(assets[0]?.body ?? "{}")).toEqual({ members: { title: expect.any(String) } });
  });

  it("refuses a shared group that is not a plain group name", () => {
    expect(() => resolveSharedGroups(["bad group"])).toThrow(/must be one translation group name/);
  });
});

describe("served location", () => {
  it("names tables under the assets directory that the immutable cache options cover", () => {
    const clientDirectory = path.join(root, "dist/client");
    const options = productionAssetsDirectoryOptions(clientDirectory);
    const [asset] = buildTranslationManifest(input()).assets;

    expect(options.immutable).toBe(true);
    expect(options.root).toBe(path.join(clientDirectory, "assets"));
    expect(assetUrlFor(asset?.fileName ?? "")).toMatch(
      new RegExp(`^${CLIENT_ASSET_URL_PREFIX}/translations/`),
    );
  });
});

describe("writeTranslationAssets", () => {
  it("writes each table under the assets directory with its hashed name, and the URL points at it", async () => {
    const assetsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-translation-assets-"));

    try {
      const { assets } = buildTranslationManifest(input());
      await writeTranslationAssets(assetsDirectory, assets);

      for (const asset of assets) {
        const written = fs.readFileSync(path.join(assetsDirectory, asset.fileName), "utf8");
        expect(written).toBe(asset.body);
        expect(assetUrlFor(asset.fileName)).toBe(`${CLIENT_ASSET_URL_PREFIX}/${asset.fileName}`);
      }
    } finally {
      fs.rmSync(assetsDirectory, { recursive: true, force: true });
    }
  });
});
