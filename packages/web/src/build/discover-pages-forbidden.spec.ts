import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SitesConfig } from "../sites/site-config.types";
import {
  DuplicateForbiddenPageError,
  ErrorPageDeclaresRouteError,
  discoverPages,
  isDiscoveredRoutablePage,
  isForbiddenPageFile,
} from "./discover-pages";

const temporaryDirectories: string[] = [];

function makeAppTree(files: Record<string, string>): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-forbidden-"));
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

const COMPONENT = "export default function C() { return null; }\n";
const routed = (routePath: string) =>
  `export const config = { route: ${JSON.stringify(routePath)} };\n${COMPONENT}`;
const relative = (appRoot: string, file: string) =>
  path.relative(appRoot, file).split(path.sep).join("/");

describe("isForbiddenPageFile", () => {
  it("matches only the forbidden.page.tsx basename", () => {
    expect(isForbiddenPageFile("/app/src/web/forbidden.page.tsx")).toBe(true);
    expect(isForbiddenPageFile("/app/src/web/$sites/staff/forbidden.page.tsx")).toBe(true);
    expect(isForbiddenPageFile("/app/src/web/forbidden.setup.ts")).toBe(false);
    expect(isForbiddenPageFile("/app/src/web/not-forbidden.page.tsx")).toBe(false);
  });
});

describe("discoverPages: forbidden.page.tsx", () => {
  it("reports it as a forbidden page with no route identity", () => {
    const appRoot = makeAppTree({
      "src/web/root.tsx": COMPONENT,
      "src/web/home.page.tsx": routed("/home"),
      "src/web/forbidden.page.tsx": COMPONENT,
      "src/web/forbidden.setup.ts": "export const config = {};\n",
    });

    const pages = discoverPages({ appRoot });
    const forbidden = pages.find((page) => page.type === "forbidden");

    expect(forbidden).toBeDefined();
    expect(relative(appRoot, forbidden!.pageFile)).toBe("src/web/forbidden.page.tsx");
    expect(relative(appRoot, forbidden!.setupFile as string)).toBe("src/web/forbidden.setup.ts");
    expect(relative(appRoot, forbidden!.appFile as string)).toBe("src/web/root.tsx");
    expect(forbidden).not.toHaveProperty("routeName");
    expect(forbidden).not.toHaveProperty("routePath");
    expect(pages.filter(isDiscoveredRoutablePage).map((page) => page.routePath)).toEqual(["/home"]);
  });

  it("keeps the forbidden page next to the error page, each its own entry", () => {
    const appRoot = makeAppTree({
      "src/web/root.tsx": COMPONENT,
      "src/web/home.page.tsx": routed("/home"),
      "src/web/error.page.tsx": COMPONENT,
      "src/web/forbidden.page.tsx": COMPONENT,
    });

    const types = discoverPages({ appRoot })
      .map((page) => page.type)
      .sort();

    expect(types).toEqual(["error", "forbidden", "page"]);
  });

  it("rejects a forbidden page that declares a route", () => {
    const appRoot = makeAppTree({
      "src/web/root.tsx": COMPONENT,
      "src/web/forbidden.page.tsx": routed("/forbidden"),
    });

    expect(() => discoverPages({ appRoot })).toThrow(ErrorPageDeclaresRouteError);
    expect(() => discoverPages({ appRoot })).toThrow(/forbidden\.page\.tsx/);
  });

  it("rejects a second forbidden page and names both files", () => {
    const appRoot = makeAppTree({
      "src/web/root.tsx": COMPONENT,
      "src/web/forbidden.page.tsx": COMPONENT,
      "src/web/shop/forbidden.page.tsx": COMPONENT,
    });

    expect(() => discoverPages({ appRoot })).toThrow(DuplicateForbiddenPageError);

    try {
      discoverPages({ appRoot });
    } catch (error) {
      expect((error as Error).message).toContain("src/web/forbidden.page.tsx");
      expect((error as Error).message).toContain("src/web/shop/forbidden.page.tsx");
    }
  });
});

describe("discoverPages with sites: forbidden.page.tsx", () => {
  const SITES: SitesConfig = {
    landing: { hosts: ["example.test"] },
    staff: { hosts: ["staff.example.test"] },
  };

  it("keeps one forbidden page per site", () => {
    const appRoot = makeAppTree({
      "src/web/$sites/landing/root.tsx": COMPONENT,
      "src/web/$sites/landing/index.page.tsx": COMPONENT,
      "src/web/$sites/staff/root.tsx": COMPONENT,
      "src/web/$sites/staff/index.page.tsx": COMPONENT,
      "src/web/$sites/staff/forbidden.page.tsx": COMPONENT,
    });

    const forbidden = discoverPages({ appRoot, sites: SITES }).filter(
      (page) => page.type === "forbidden",
    );

    expect(forbidden.map((page) => page.site)).toEqual(["staff"]);
  });

  it("rejects more than one forbidden page in a site", () => {
    const appRoot = makeAppTree({
      "src/web/$sites/landing/root.tsx": COMPONENT,
      "src/web/$sites/landing/index.page.tsx": COMPONENT,
      "src/web/$sites/staff/root.tsx": COMPONENT,
      "src/web/$sites/staff/index.page.tsx": COMPONENT,
      "src/web/$sites/staff/forbidden.page.tsx": COMPONENT,
      "src/web/$sites/staff/x/forbidden.page.tsx": COMPONENT,
    });

    expect(() => discoverPages({ appRoot, sites: SITES })).toThrow(
      /site "staff" has more than one forbidden page/,
    );
  });
});
