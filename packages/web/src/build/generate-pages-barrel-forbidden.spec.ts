import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatePagesBarrel } from "./generate-pages-barrel";

const temporaryDirectories: string[] = [];

function makeAppTree(files: Record<string, string>): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-barrel-forbidden-"));
  temporaryDirectories.push(appRoot);

  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(appRoot, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, "utf-8");
  }

  return appRoot;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
  }
});

const APP = "export default function App() { return null; }\n";
const PAGE =
  'export const config = { route: "/" };\nexport default function Page() { return null; }\n';
const SITES = {
  landing: { hosts: ["example.test"] },
  staff: { hosts: ["staff.example.test"] },
};

describe("generatePagesBarrel: forbidden page", () => {
  it("imports the forbidden page and its setup and lists it in the manifest, outside the page table", async () => {
    const appRoot = makeAppTree({
      "src/web/root.tsx": APP,
      "src/web/home.page.tsx": PAGE,
      "src/web/forbidden.page.tsx": APP,
      "src/web/forbidden.setup.ts": "export const config = {};\n",
    });

    const result = await generatePagesBarrel({
      appRoot,
      productionDir: path.join(appRoot, ".warlock", "production"),
      clientDir: "dist/client",
    });

    expect(result.contents).toContain("import * as forbiddenPage from");
    expect(result.contents).toContain("import * as forbiddenPageSetup from");
    expect(result.contents).toContain(
      'forbiddenPage: { module: forbiddenPage, sourceFile: "src/web/forbidden.page.tsx"',
    );
    expect(result.contents).toContain(
      'setupModule: forbiddenPageSetup, setupSourceFile: "src/web/forbidden.setup.ts"',
    );
    expect(result.pageCount).toBe(1);
    // The framework 404 catch-all is always recorded; the forbidden page is not a route.
    expect(result.pageRoutes.routes.map((route) => route.path)).toEqual(["/", "/*"]);
  });

  it("leaves the barrel without a forbiddenPage entry when the app has none", async () => {
    const appRoot = makeAppTree({
      "src/web/root.tsx": APP,
      "src/web/home.page.tsx": PAGE,
    });

    const result = await generatePagesBarrel({
      appRoot,
      productionDir: path.join(appRoot, ".warlock", "production"),
      clientDir: "dist/client",
    });

    expect(result.contents).not.toContain("forbiddenPage");
  });

  it("gives each site its own forbidden page", async () => {
    const appRoot = makeAppTree({
      "src/web/$sites/landing/root.tsx": APP,
      "src/web/$sites/landing/index.page.tsx": PAGE,
      "src/web/$sites/staff/root.tsx": APP,
      "src/web/$sites/staff/index.page.tsx": PAGE,
      "src/web/$sites/staff/forbidden.page.tsx": APP,
    });

    const result = await generatePagesBarrel({
      appRoot,
      productionDir: path.join(appRoot, ".warlock", "production"),
      clientDir: "dist/client",
      sites: SITES,
    });

    // `staff` is the second configured site, so it is index 1.
    expect(result.contents).toContain("import * as forbiddenPage1 from");
    expect(result.contents).toContain("forbiddenPage: { module: forbiddenPage1");
    expect(result.contents).not.toContain("forbiddenPage0");
  });
});
