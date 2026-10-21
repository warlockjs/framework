import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { usageOf } from "@warlock.js/core";
import { resolvePageRouteIdentity } from "../routing/route-identity";
import {
  productionGlobalTranslationDeliveryInput,
  registerRouteSourceFile,
  resetRouteSourceFiles,
} from "./global-translations";
import { resolveRoute } from "./install-page-routes-from-manifest";

/**
 * Route-name equality: the name a payload carries (`bundle.route.name`, the
 * entry name the production installer resolved) is the name the build's usage
 * is looked up under.
 *
 * The build derives its route names from the page's path relative to its web
 * root (`build/discover-pages.ts`), and the installer from the manifest's
 * source file (`resolveRoute`). Both call `resolvePageRouteIdentity`, but with
 * different path arguments, so the two are not equal by construction. The
 * install therefore records the name it resolved for each page, against that
 * page's source file, and the usage is looked up through that record. These
 * cases pin the agreement that the record relies on.
 */

/** The build's own call for a page, as `discover-pages.ts` makes it. */
function buildName(
  relativeToWebRoot: string,
  route: Parameters<typeof resolvePageRouteIdentity>[0],
  site?: string,
): string {
  return resolvePageRouteIdentity(route, relativeToWebRoot, relativeToWebRoot, site).name;
}

beforeEach(() => {
  resetRouteSourceFiles();
});

describe("route names agree between the build and the installer", () => {
  it("agrees on a filesystem-derived name for a page in a nested directory", () => {
    const sourceFile = "src/web/orders/index.page.tsx";
    const relative = path.posix.relative("src/web", sourceFile);

    expect(resolveRoute(undefined, sourceFile).name).toBe(buildName(relative, undefined));
    expect(resolveRoute(undefined, sourceFile).name).toBe("orders.index");
  });

  it("agrees on an explicit name declared through the route export", () => {
    const route = { path: "/orders", name: "orders.list" };
    const sourceFile = "src/web/orders/index.page.tsx";
    const relative = path.posix.relative("src/web", sourceFile);

    expect(resolveRoute(route, sourceFile).name).toBe("orders.list");
    expect(buildName(relative, route)).toBe("orders.list");
  });

  it("agrees on a site page's name, with the site prefix and without the `$sites` folder", () => {
    const sourceFile = "src/web/$sites/shop/orders/index.page.tsx";
    const relativeToSite = "orders/index.page.tsx";

    expect(resolveRoute(undefined, sourceFile, "shop").name).toBe(
      buildName(relativeToSite, undefined, "shop"),
    );
  });
});

describe("the installed name is the lookup key", () => {
  it("finds the usage of a page under the name its installer resolved", () => {
    const sourceFile = "src/web/orders/index.page.tsx";
    const installedName = resolveRoute(undefined, sourceFile).name;
    registerRouteSourceFile(installedName, sourceFile);

    const lookup = productionGlobalTranslationDeliveryInput({
      sharedGroups: ["app", "common"],
      prune: true,
      usage: { [sourceFile]: { keys: ["orders.title"], prefixes: [], dynamic: false } },
    });

    expect(lookup.usageFor(installedName)?.keys).toEqual(["orders.title"]);
    expect(usageOf({ keys: ["orders.title"] }).keys).toEqual(["orders.title"]);
  });

  it("still finds the usage when the build's derivation and the installer's differ", () => {
    // A source root with two segments (`lib/src`): the installer drops the first
    // two segments to reach the web-relative path, so it sees `src/web/...`,
    // while the build sees `orders/...`. The recorded name keeps the lookup
    // correct either way.
    const sourceFile = "lib/src/web/orders/index.page.tsx";
    const installedName = resolveRoute(undefined, sourceFile).name;
    const builtName = buildName("orders/index.page.tsx", undefined);

    expect(installedName).not.toBe(builtName);

    registerRouteSourceFile(installedName, sourceFile);
    const lookup = productionGlobalTranslationDeliveryInput({
      sharedGroups: ["app"],
      prune: true,
      usage: { [sourceFile]: { keys: ["orders.title"], prefixes: [], dynamic: false } },
    });

    expect(lookup.usageFor(installedName)?.keys).toEqual(["orders.title"]);
    expect(lookup.usageFor(builtName)).toBeUndefined();
  });
});
