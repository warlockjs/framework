import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectPages,
  discoverGraphPages,
  exportsName,
  layoutChainOf,
  type WebBuildModule,
} from "./collect-pages";
import type { InspectWarning } from "./inspect-report.types";

// Loaded by path at run time so the typecheck of core does not compile web's source.
const webBuildEntry = path.resolve(__dirname, "../../../../web/src/build/index.ts");
const { discoverPageGraph } = (await import(
  /* @vite-ignore */ webBuildEntry
)) as Required<WebBuildModule>;

let root: string;

function write(relative: string, source: string): string {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);

  return file;
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-inspect-pages-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("page facts", () => {
  it("reads the layout chain from the web root down, and which files export a loader", () => {
    write("src/app/web/root.tsx", "export default function Root() { return null; }");
    write("src/app/web/layout.tsx", "export default function Layout() { return null; }");
    write(
      "src/app/web/blog/layout.tsx",
      "export async function loader() { return {}; }\nexport default function L() { return null; }",
    );
    const page = write(
      "src/app/web/blog/[slug].page.tsx",
      "const loader = async () => ({});\nexport { loader };\nexport default function Page() { return null; }",
    );

    expect(layoutChainOf(page, root).map((file) => path.relative(root, file))).toEqual([
      path.join("src", "app", "web", "layout.tsx"),
      path.join("src", "app", "web", "blog", "layout.tsx"),
    ]);
    expect(exportsName(page, "loader")).toBe(true);
    expect(exportsName(page, "action")).toBe(false);

    const warnings: InspectWarning[] = [];
    const pages = collectPages(
      [{ path: "/blog/:slug", name: "blog.show", file: page, guard: "user" }, { file: 1 }],
      root,
      warnings,
    );

    expect(pages).toEqual([
      {
        path: "/blog/:slug",
        name: "blog.show",
        file: "src/app/web/blog/[slug].page.tsx",
        setupFile: null,
        site: null,
        layouts: ["src/app/web/layout.tsx", "src/app/web/blog/layout.tsx"],
        loaders: ["src/app/web/blog/layout.tsx", "src/app/web/blog/[slug].page.tsx"],
        actions: [],
        guard: "user",
      },
    ]);
    expect(warnings).toHaveLength(1);
  });

  it("reports no pages for an app without the web connector", () => {
    expect(collectPages(undefined, root, [])).toEqual([]);
  });

  it("reports setup file, site and the build's layout chain for a multi-site tree", async () => {
    const page = "export default function Page() { return null; }";
    const layout = "export default function Layout() { return null; }";

    write("src/web/$sites/shop/root.tsx", layout);
    write("src/web/$sites/shop/layout.tsx", layout);
    write("src/web/$sites/shop/cart/layout.tsx", "export const config = { middleware: [] };");
    write("src/web/$sites/shop/cart/cart.page.tsx", page);
    write(
      "src/web/$sites/shop/cart/cart.setup.ts",
      "export async function loader() { return {}; }",
    );
    write("src/web/$sites/admin/root.tsx", layout);
    write("src/web/$sites/admin/home.page.tsx", page);

    const sites = {
      shop: { hosts: ["shop.test"] },
      admin: { hosts: ["admin.test"], basePath: "/admin" },
    };
    const warnings: InspectWarning[] = [];
    const graphPages = await discoverGraphPages(
      root,
      warnings,
      async () => ({ discoverPageGraph }),
      sites,
    );
    const expected = discoverPageGraph({ appRoot: root, sites }).pages.filter(
      (entry) => entry.type === "page",
    );
    const pages = collectPages(undefined, root, warnings, undefined, graphPages);
    const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");

    expect(warnings).toEqual([]);
    expect(pages).toHaveLength(2);

    for (const entry of expected) {
      const reported = pages.find((candidate) => candidate.file === rel(entry.pageFile));

      expect(reported?.layouts).toEqual(entry.layouts.map(rel));
      expect(reported?.site).toBe(entry.site ?? null);
      expect(reported?.setupFile).toBe(entry.setupFile ? rel(entry.setupFile) : null);
    }

    const cart = pages.find((candidate) => candidate.site === "shop");

    expect(cart?.layouts).toEqual([
      "src/web/$sites/shop/layout.tsx",
      "src/web/$sites/shop/cart/layout.tsx",
    ]);
    expect(cart?.setupFile).toBe("src/web/$sites/shop/cart/cart.setup.ts");
    expect(cart?.loaders).toEqual(["src/web/$sites/shop/cart/cart.setup.ts"]);
    expect(pages.find((candidate) => candidate.site === "admin")?.setupFile).toBeNull();
  });

  it("returns no graph when web is absent", async () => {
    expect(await discoverGraphPages(root, [], async () => undefined)).toBeUndefined();
  });

  it("warns and falls back to the installed pages when the page graph cannot be read", async () => {
    write("src/web/home.page.tsx", "export default function Page() { return null; }");

    const warnings: InspectWarning[] = [];
    const graphPages = await discoverGraphPages(root, warnings, async () => ({
      discoverPageGraph: () => {
        throw new Error("Duplicate page route name");
      },
    }));
    const pages = collectPages(
      [{ path: "/", name: "home", file: "src/web/home.page.tsx" }],
      root,
      warnings,
      undefined,
      graphPages,
    );

    expect(graphPages).toBeUndefined();
    expect(warnings).toEqual([expect.objectContaining({ source: "pages" })]);
    expect(warnings[0]?.message).toContain("Duplicate page route name");
    expect(pages.map((page) => page.file)).toEqual(["src/web/home.page.tsx"]);
  });
});
