import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectPages, exportsName, layoutChainOf } from "./collect-pages";
import type { InspectWarning } from "./inspect-report.types";

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
});
