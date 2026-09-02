import { describe, expect, it } from "vitest";
import {
  diffPageRoutes,
  type PageRoute,
} from "../../../../src/cli/commands/routes/diff-page-routes";

/**
 * `warlock routes:diff` compares the page-route manifest `warlock build` wrote
 * against the live router's page surface.
 *
 * Two properties are under test and the SECOND one is the one that matters:
 *
 *  1. Immediately after a successful build, with nothing changed, the diff is
 *     clean. (The two false positives QA measured: the catch-all's `*` vs `/*`,
 *     and a registration-assigned `.get` name suffix.)
 *  2. A route that GENUINELY changed is still reported. A diff that reports
 *     nothing is not a fix.
 *
 * Source: core/src/cli/commands/routes/diff-page-routes.ts.
 */
function page(partial: Partial<PageRoute>): PageRoute {
  return { method: "GET", path: "/", name: "home", source: "src/web/home.page.tsx", ...partial };
}

/** The manifest surface a clean `warlock build` leaves behind. */
const MANIFEST: PageRoute[] = [
  page({ path: "/", name: "home", source: "src/web/home.page.tsx" }),
  page({
    path: "/api/rem-release-form",
    name: "api.rem-release-form",
    source: "src/web/api/rem-release-form.page.tsx",
  }),
  // Written through `normalizeRoutePath`, so the manifest now records the same
  // catch-all the router serves.
  page({ path: "/*", name: "notFound", source: "src/web/not-found.page.tsx" }),
];

/** The same surface as the running router reports it. */
const LIVE: PageRoute[] = [
  page({ path: "/", name: "home", source: "src/web/home.page.tsx" }),
  page({
    path: "/api/rem-release-form",
    // Assigned at registration because an API route already claimed this name
    // under another method. The manifest cannot know this.
    name: "api.rem-release-form.get",
    source: "src/web/api/rem-release-form.page.tsx",
  }),
  page({ path: "/*", name: "notFound", source: "src/web/not-found.page.tsx" }),
];

describe("diffPageRoutes — a clean baseline right after `warlock build`", () => {
  it("reports nothing when nothing changed", () => {
    expect(diffPageRoutes(MANIFEST, LIVE)).toEqual({ changes: [], removed: [], added: [] });
  });

  it("does not report the catch-all whose manifest path is now normalized", () => {
    const diff = diffPageRoutes(
      [page({ path: "/*", name: "notFound", source: "src/web/not-found.page.tsx" })],
      [page({ path: "/*", name: "notFound", source: "src/web/not-found.page.tsx" })],
    );

    expect(diff.changes).toHaveLength(0);
  });

  it("does not report a name that only gained the registration method suffix", () => {
    const diff = diffPageRoutes(
      [page({ path: "/x", name: "x", source: "src/web/x.page.tsx" })],
      [page({ path: "/x", name: "x.get", source: "src/web/x.page.tsx" })],
    );

    expect(diff).toEqual({ changes: [], removed: [], added: [] });
  });

  it("still reports a stale manifest whose catch-all was never normalized", () => {
    // The fix is on the WRITING side, not here: an old `*` manifest is honest
    // drift against a `/*` router and must not be silently forgiven.
    const diff = diffPageRoutes(
      [page({ path: "*", name: "notFound", source: "src/web/not-found.page.tsx" })],
      [page({ path: "/*", name: "notFound", source: "src/web/not-found.page.tsx" })],
    );

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].before.path).toBe("*");
    expect(diff.changes[0].after.path).toBe("/*");
  });
});

describe("diffPageRoutes — REAL drift is still detected", () => {
  it("reports a page whose route path changed", () => {
    const live = LIVE.map((route) =>
      route.name === "home" ? page({ ...route, path: "/landing" }) : route,
    );

    const diff = diffPageRoutes(MANIFEST, live);

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].before.path).toBe("/");
    expect(diff.changes[0].after.path).toBe("/landing");
    expect(diff.removed).toHaveLength(0);
    expect(diff.added).toHaveLength(0);
  });

  it("reports a page whose route name changed, suffix or no suffix", () => {
    const live = LIVE.map((route) =>
      route.path === "/api/rem-release-form"
        ? page({ ...route, name: "api.release-form.get" })
        : route,
    );

    const diff = diffPageRoutes(MANIFEST, live);

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].before.name).toBe("api.rem-release-form");
    expect(diff.changes[0].after.name).toBe("api.release-form.get");
  });

  it("reports a name that changed to a DIFFERENT method's suffix", () => {
    const live = LIVE.map((route) =>
      route.path === "/api/rem-release-form"
        ? page({ ...route, name: "api.rem-release-form.post" })
        : route,
    );

    expect(diffPageRoutes(MANIFEST, live).changes).toHaveLength(1);
  });

  it("reports a page deleted since the build", () => {
    const live = LIVE.filter((route) => route.path !== "/api/rem-release-form");

    const diff = diffPageRoutes(MANIFEST, live);

    expect(diff.removed.map((route) => route.path)).toEqual(["/api/rem-release-form"]);
    expect(diff.added).toHaveLength(0);
    expect(diff.changes).toHaveLength(0);
  });

  it("reports a page added since the build", () => {
    const live = [
      ...LIVE,
      page({ path: "/checkout", name: "checkout", source: "src/web/c.page.tsx" }),
    ];

    const diff = diffPageRoutes(MANIFEST, live);

    expect(diff.added.map((route) => route.path)).toEqual(["/checkout"]);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changes).toHaveLength(0);
  });

  it("reports both sides when a changed page also moved file, as add + remove", () => {
    const live = LIVE.map((route) =>
      route.name === "home"
        ? page({ path: "/landing", name: "landing", source: "src/web/landing.page.tsx" })
        : route,
    );

    const diff = diffPageRoutes(MANIFEST, live);

    expect(diff.removed.map((route) => route.path)).toEqual(["/"]);
    expect(diff.added.map((route) => route.path)).toEqual(["/landing"]);
  });

  it("does not treat a relocated but otherwise identical page as drift", () => {
    const live = LIVE.map((route) =>
      route.name === "home" ? page({ ...route, source: "src/web/pages/home.page.tsx" }) : route,
    );

    expect(diffPageRoutes(MANIFEST, live)).toEqual({ changes: [], removed: [], added: [] });
  });
});
