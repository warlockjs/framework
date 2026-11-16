import { describe, expect, it } from "vitest";
import { at, feature, flow, snapshot, withApps } from "../../tests/check/snapshot-builder";
import type {
  BookMobileApp,
  GrimoireFinding,
  GrimoireSnapshot,
  WrittenApp,
  WrittenBlockRow,
  WrittenPage,
} from "../contracts";
import { checkApps } from "./check-apps";
import { matchApps } from "./match-apps";

const FILE = "grimoire/apps/web/pages/home/README.md";

function row(
  block: string,
  flowRef: string | null,
  who: string[] = [],
  changes: string[] = [],
): WrittenBlockRow {
  return {
    block,
    flow: flowRef,
    who: { everyone: who.length === 0, conditions: who },
    changesWith: changes.map((condition) => ({ condition, text: "x" })),
    at: at(FILE, 8),
  };
}

function page(id: string, patch: Partial<WrittenPage> = {}): WrittenPage {
  return {
    file: `grimoire/apps/web/pages/${id}/README.md`,
    app: "web",
    type: "page",
    id,
    route: { value: "/", at: at(FILE, 2) },
    screen: null,
    layout: null,
    heading: null,
    purpose: null,
    blocks: [],
    alsoReachedFrom: [],
    blockFiles: [],
    ...patch,
  };
}

const mobileFiles: BookMobileApp = {
  id: "mobile",
  root: "mobile",
  routing: "files",
  routesDir: "mobile/app",
  screens: [{ route: "/products/[id]", file: "mobile/app/products/[id].tsx", layouts: [] }],
};

/** Site app `web` (root src/web) and mobile app `phone`, matched to what the code reports. */
function build(
  patch: {
    app?: Partial<WrittenApp>;
    mobileApp?: Partial<WrittenApp>;
    mobile?: BookMobileApp;
  } = {},
): GrimoireSnapshot {
  const target = snapshot();
  const [web] = withApps(target, ["web"]).written.apps;

  if (!web) throw new Error("no app");

  Object.assign(web, {
    root: { value: "src/web", at: at("grimoire/apps/web/README.md", 4) },
    conditions: [{ name: "guest", text: "x", at: at("r", 1) }],
    ...patch.app,
  });

  const phone: WrittenApp = {
    ...web,
    dir: "grimoire/apps/phone",
    id: { value: "phone", at: at("grimoire/apps/phone/README.md", 2) },
    type: { value: "mobile", at: at("grimoire/apps/phone/README.md", 3) },
    root: { value: "mobile", at: at("grimoire/apps/phone/README.md", 4) },
    conditions: [],
    layouts: [],
    pages: [],
    screens: [],
    ...patch.mobileApp,
  };

  target.written.apps = [web, phone];
  target.written.features = [feature("catalog", { flows: [flow("catalog", "browse")] })];
  target.book.facts.sites = [{ id: "default", root: "src/web", basePath: null }];
  target.book.facts.mobile = [patch.mobile ?? mobileFiles];
  target.book.facts.pages = [
    {
      site: "default",
      route: "/",
      name: "home",
      file: "a",
      setupFile: null,
      layouts: [],
      loaders: [],
      actions: [],
      requires: [],
      reachedFrom: [],
    },
  ];
  target.book.facts.named = [{ type: "mail", name: "welcome", file: null }];
  target.apps = matchApps(target.written.apps, target.book.facts);

  return target;
}

function codes(findings: GrimoireFinding[]): string[] {
  return findings.map((finding) => finding.code);
}

describe("checkApps", () => {
  it("passes a consistent app", () => {
    const target = build({
      app: {
        pages: [
          page("home", {
            blocks: [row("Hero", "catalog/browse", ["guest"], ["guest"])],
            layout: { value: "site", at: at(FILE, 3) },
          }),
        ],
        layouts: [{ file: "l", app: "web", id: "site", heading: null, blocks: [] }],
      },
      mobileApp: {
        screens: [
          page("product", {
            app: "phone",
            type: "screen",
            route: { value: "/products/[id]", at: at(FILE, 2) },
          }),
        ],
      },
    });

    expect(checkApps(target)).toEqual([]);
  });

  it("GR5001: a block row or block file points to a missing flow, and fills the subject", () => {
    const target = build({
      app: {
        pages: [
          page("home", {
            blocks: [row("Hero", "catalog/gone")],
            blockFiles: [
              {
                file: "grimoire/apps/web/pages/home/blocks/hero.md",
                app: "web",
                page: "home",
                id: "hero",
                flow: { value: "catalog/also-gone", at: at("b", 2) },
                heading: null,
                details: [],
              },
            ],
          }),
        ],
      },
    });
    const findings = checkApps(target);

    expect(codes(findings)).toEqual(["GR5001", "GR5001"]);
    expect(findings[0]?.subject).toMatchObject({
      feature: "catalog",
      flow: "catalog/gone",
      app: "web",
    });
  });

  it("GR5002: a condition used in a row but not declared", () => {
    const target = build({
      app: { pages: [page("home", { blocks: [row("Hero", null, ["vip"], ["pref"])] })] },
    });

    expect(checkApps(target).map((finding) => finding.message)).toEqual([
      'condition "vip" is not declared in the README of app "web"',
      'condition "pref" is not declared in the README of app "web"',
    ]);
  });

  it("GR5003: a page whose route is gone, by the site's pages", () => {
    const target = build({
      app: { pages: [page("old", { route: { value: "/old", at: at(FILE, 2) } })] },
    });

    expect(codes(checkApps(target))).toEqual(["GR5003"]);
  });

  it("GR5004: a layout with no file", () => {
    const target = build({
      app: { pages: [page("home", { layout: { value: "ghost", at: at(FILE, 3) } })] },
    });

    expect(codes(checkApps(target))).toEqual(["GR5004"]);
  });

  it("GR5005: an app root that matches nothing", () => {
    const target = build({ app: { root: { value: "src/web/$sites/nowhere", at: at("r", 4) } } });

    expect(codes(checkApps(target))).toContain("GR5005");
  });

  it("GR5006: a screen route missing from a file-routed app, and a screen with no route", () => {
    const target = build({
      mobileApp: {
        screens: [
          page("gone", {
            app: "phone",
            type: "screen",
            route: { value: "/gone", at: at(FILE, 2) },
          }),
          page("named", {
            app: "phone",
            type: "screen",
            route: null,
            screen: { value: "Named", at: at(FILE, 2) },
          }),
        ],
      },
    });

    expect(codes(checkApps(target))).toEqual(["GR5006", "GR5006"]);
  });

  it("GR5006: a code-navigated app's declared screens are not checked against files", () => {
    const target = build({
      mobile: { ...mobileFiles, routing: "code", routesDir: null, screens: [] },
      mobileApp: {
        screens: [
          page("orders", {
            app: "phone",
            type: "screen",
            route: null,
            screen: { value: "Orders", at: at(FILE, 2) },
          }),
        ],
      },
    });

    expect(checkApps(target)).toEqual([]);
  });

  it("GR5007: a block file with no row in the page's table", () => {
    const blockFiles = [
      {
        file: "grimoire/apps/web/pages/home/blocks/new-arrivals.md",
        app: "web",
        page: "home",
        id: "new-arrivals",
        flow: null,
        heading: null,
        details: [],
      },
    ];
    const failing = build({ app: { pages: [page("home", { blockFiles })] } });
    const passing = build({
      app: { pages: [page("home", { blocks: [row("New arrivals", null)], blockFiles })] },
    });

    expect(codes(checkApps(failing))).toEqual(["GR5007"]);
    expect(checkApps(passing)).toEqual([]);
  });

  it("GR5008: an entry point that names nothing", () => {
    const entries = [
      { kind: "mail", name: "welcome", at: at(FILE, 12) },
      { kind: "mail", name: "missing", at: at(FILE, 13) },
      { kind: "notification", name: "ping", at: at(FILE, 14) },
      { kind: "page", name: "/", at: at(FILE, 15) },
      { kind: "page", name: "/nowhere", at: at(FILE, 16) },
      { kind: "outside service", name: "anything", at: at(FILE, 17) },
    ];
    const findings = checkApps(
      build({ app: { pages: [page("home", { alsoReachedFrom: entries })] } }),
    );

    expect(findings.map((finding) => finding.at?.line)).toEqual([13, 14, 16]);
    expect(codes(findings)).toEqual(["GR5008", "GR5008", "GR5008"]);
  });

  it("GR5008: a screen entry checks the declared and the file-based screens", () => {
    const entries = [
      { kind: "screen", name: "/products/[id]", at: at(FILE, 1) },
      { kind: "screen", name: "/nope", at: at(FILE, 2) },
    ];
    const findings = checkApps(
      build({
        mobileApp: {
          screens: [
            page("home", {
              app: "phone",
              type: "screen",
              route: { value: "/products/[id]", at: at(FILE, 2) },
              alsoReachedFrom: entries,
            }),
          ],
        },
      }),
    );

    expect(findings.map((finding) => finding.at?.line)).toEqual([2]);
  });

  it("GR5009: a site or mobile app with no folder, only when grimoire/apps has apps", () => {
    const target = build();

    target.book.facts.sites.push({ id: "admin", root: "src/web/$sites/admin", basePath: null });

    expect(checkApps(target).map((finding) => finding.message)).toEqual([
      'site "admin" (src/web/$sites/admin) has no folder in grimoire/apps',
    ]);

    const empty = snapshot();

    empty.book.facts.sites = target.book.facts.sites;
    expect(checkApps(empty)).toEqual([]);
  });

  it("fills the page's flow when its blocks share one", () => {
    const target = build({
      app: {
        pages: [
          page("home", {
            blocks: [row("A", "catalog/browse"), row("B", "catalog/browse")],
            layout: { value: "ghost", at: at(FILE, 3) },
          }),
        ],
      },
    });

    expect(checkApps(target)[0]?.subject).toMatchObject({
      feature: "catalog",
      flow: "catalog/browse",
    });
  });
});
