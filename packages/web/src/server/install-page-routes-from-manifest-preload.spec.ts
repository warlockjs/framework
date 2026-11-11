/**
 * Production installs read the client manifest once, and give every page
 * handler `modulepreload` URLs for its own chunks (root, its layouts, the page
 * and their static imports) beside the hydration entry's.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageRouteHandler, PageRouteHandlerOptions } from "./create-page-route-handler";
import {
  installPageRoutesFromManifest,
  type InstallPageRoutesFromManifestOptions,
} from "./install-page-routes-from-manifest";
import type { PageManifest, PageManifestPageEntry } from "./page-manifest";

const { manifestReads } = vi.hoisted(() => ({ manifestReads: [] as string[] }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    if (String(args[0]).endsWith(path.join(".vite", "manifest.json"))) {
      manifestReads.push(String(args[0]));
    }
    return actual.readFileSync(...args);
  }) as typeof actual.readFileSync;

  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

const temporaryDirectories: string[] = [];

afterEach(() => {
  manifestReads.length = 0;
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
  }
});

function makeClientDir(manifest: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-route-preload-"));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, ".vite"), { recursive: true });
  fs.writeFileSync(path.join(root, ".vite", "manifest.json"), JSON.stringify(manifest), "utf-8");

  return root;
}

function install(manifest: PageManifest, overrides: Partial<InstallPageRoutesFromManifestOptions>) {
  const built: PageRouteHandlerOptions[] = [];
  const router = {
    get: () => undefined,
    list: () => [],
  } as unknown as InstallPageRoutesFromManifestOptions["router"];

  installPageRoutesFromManifest({
    router,
    manifest,
    createHandler: (options: PageRouteHandlerOptions): PageRouteHandler => {
      built.push(options);
      return async () => undefined;
    },
    ...overrides,
  });

  return built;
}

const layout = {
  module: { default: () => null, config: { prefix: "/shop" } },
  sourceFile: "src/app/shop/web/layout.tsx",
};

function page(name: string, layouts = [layout]): PageManifestPageEntry {
  return {
    module: { default: () => null, config: { route: `/${name}` } },
    sourceFile: `src/app/shop/web/${name}.page.tsx`,
    layouts,
  };
}

function manifestOf(pages: PageManifestPageEntry[]): PageManifest {
  return { app: { module: { default: () => null }, sourceFile: "src/web/root.tsx" }, pages };
}

const CLIENT_MANIFEST = {
  "src/entry/index.ts": {
    file: "assets/hydration.js",
    name: "hydration",
    isEntry: true,
    imports: ["_vendor-react.js"],
  },
  "_vendor-react.js": { file: "assets/vendor-react.js" },
  "src/web/root.tsx": { file: "assets/root.js", imports: ["_vendor-react.js"] },
  "src/app/shop/web/layout.tsx": { file: "assets/layout.js", imports: ["_shared.js"] },
  "_shared.js": { file: "assets/shared.js", imports: ["src/entry/index.ts"] },
  "src/app/shop/web/cart.page.tsx": { file: "assets/cart.page.js", imports: ["_cart-utils.js"] },
  "_cart-utils.js": { file: "assets/cart-utils.js" },
  "src/app/shop/web/orders.page.tsx": { file: "assets/orders.page.js" },
  "src/app/shop/web/wishlist.page.tsx": { file: "assets/wishlist.page.js" },
  "src/app/shop/web/404.page.tsx": { file: "assets/404.page.js" },
};

const ENTRY_PRELOADS = ["/assets/vendor-react.js"];

describe("installPageRoutesFromManifest — route module preloads", () => {
  it("preloads the page's own chain after the entry's, never another page's chunk", () => {
    const built = install(manifestOf([page("cart"), page("orders")]), {
      clientDir: makeClientDir(CLIENT_MANIFEST),
      hydrationClientModuleUrl: "/assets/hydration.js",
      hydrationClientModulePreloadUrls: ENTRY_PRELOADS,
    });

    const cart = built.find((options) => options.pageFile.endsWith("cart.page.tsx"));

    expect(cart?.hydrationClientModulePreloadUrls).toEqual([
      "/assets/vendor-react.js",
      "/assets/root.js",
      "/assets/layout.js",
      "/assets/shared.js",
      "/assets/cart.page.js",
      "/assets/cart-utils.js",
    ]);
    expect(cart?.hydrationClientModulePreloadUrls).not.toContain("/assets/orders.page.js");
  });

  it("gives the not-found page root and its own chunk, without the layout it does not render in", () => {
    const notFound: PageManifestPageEntry = {
      module: { default: () => null },
      sourceFile: "src/app/shop/web/404.page.tsx",
      layouts: [layout],
    };
    const built = install(manifestOf([page("cart"), notFound]), {
      clientDir: makeClientDir(CLIENT_MANIFEST),
      hydrationClientModuleUrl: "/assets/hydration.js",
      hydrationClientModulePreloadUrls: ENTRY_PRELOADS,
    });

    const notFoundHandler = built.find((options) => options.pageFile.endsWith("404.page.tsx"));

    expect(notFoundHandler?.hydrationClientModulePreloadUrls).toEqual([
      "/assets/vendor-react.js",
      "/assets/root.js",
      "/assets/404.page.js",
    ]);
  });

  it("keeps the entry's preloads unchanged when the build carried no client bundle", () => {
    const built = install(manifestOf([page("cart")]), {
      hydrationClientModulePreloadUrls: ENTRY_PRELOADS,
    });

    expect(built[0]?.hydrationClientModulePreloadUrls).toBe(ENTRY_PRELOADS);
  });

  it("reads and parses the client manifest once for every page of the install", () => {
    const clientDir = makeClientDir(CLIENT_MANIFEST);

    install(manifestOf([page("cart"), page("orders"), page("wishlist")]), {
      clientDir,
      hydrationClientModuleUrl: "/assets/hydration.js",
      hydrationClientModulePreloadUrls: ENTRY_PRELOADS,
    });

    expect(manifestReads).toEqual([path.join(clientDir, ".vite", "manifest.json")]);
  });
});
