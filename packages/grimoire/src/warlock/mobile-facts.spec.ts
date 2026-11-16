import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectMobileFacts } from "./mobile-facts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures");
const shop = path.join(fixtures, "shop");

describe("collectMobileFacts", () => {
  it("lists file-based screens: groups, params, layouts, platform files, no special files", async () => {
    const [app] = await collectMobileFacts(path.join(fixtures, "apps-expo"));

    expect(app).toMatchObject({
      id: "mobile",
      root: "mobile",
      routing: "files",
      routesDir: "mobile/app",
    });
    expect(app?.screens.map((screen) => [screen.route, screen.file])).toEqual([
      ["/", "mobile/app/(tabs)/index.tsx"],
      ["/[...missing]", "mobile/app/[...missing].tsx"],
      ["/products", "mobile/app/products/index.tsx"],
      ["/products/[id]", "mobile/app/products/[id].tsx"],
      ["/profile", "mobile/app/(tabs)/profile.tsx"],
      ["/settings", "mobile/app/settings.tsx"],
    ]);
  });

  it("gives each screen its layouts, outermost first", async () => {
    const [app] = await collectMobileFacts(path.join(fixtures, "apps-expo"));
    const byRoute = Object.fromEntries(
      (app?.screens ?? []).map((screen) => [screen.route, screen.layouts]),
    );

    expect(byRoute["/"]).toEqual(["mobile/app/_layout.tsx", "mobile/app/(tabs)/_layout.tsx"]);
    expect(byRoute["/settings"]).toEqual(["mobile/app/_layout.tsx"]);
  });

  it("reports a code-navigated app with no screens", async () => {
    expect(await collectMobileFacts(path.join(fixtures, "apps-code-nav"))).toEqual([
      { id: "mobile", root: "mobile", routing: "code", routesDir: null, screens: [] },
    ]);
  });

  it("finds the shop fixture's file-routed app", async () => {
    const [app] = await collectMobileFacts(shop, {
      mobile: [{ root: "mobile", routing: "files" }],
    });

    expect(app?.screens.map((screen) => screen.route)).toEqual(["/", "/products/[id]"]);
  });

  it("honours explicit options, an id and an unknown folder", async () => {
    const apps = await collectMobileFacts(path.join(fixtures, "apps-expo"), {
      mobile: [
        { root: "./mobile/", id: "phone", routing: "files" },
        { root: "nope", routing: "files" },
      ],
    });

    expect(apps.map((app) => [app.id, app.root, app.routesDir, app.screens.length])).toEqual([
      ["phone", "mobile", "mobile/app", 6],
      ["nope", "nope", null, 0],
    ]);
  });

  it("returns nothing when no folder looks like a mobile app", async () => {
    expect(await collectMobileFacts(path.join(fixtures, "apps-expo", "mobile", "app"))).toEqual([]);
  });
});
