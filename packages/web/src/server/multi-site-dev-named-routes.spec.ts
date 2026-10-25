import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router, container } from "@warlock.js/core";
import type { SitesConfig } from "../sites/site-config.types";
import * as createPageRouteHandlerModule from "./create-page-route-handler";
import type { PageRouteHandler, PageRouteHandlerOptions } from "./create-page-route-handler";
import { installPageRoutes, type InstallPageRoutesOptions } from "./install-page-routes";
import { createSiteDispatch } from "./site-dispatch";

/**
 * The multi-site development regression: with `web.sites`, the dev installer
 * handed every page the per-site registration facade, so the first render of
 * ANY page in development threw "getNamedApiRoutes is not a function" and
 * answered 500 while production (route names from the build manifest) was fine.
 *
 * Two sites, one page each, and each page names a registered route with
 * `apiHref("ping.show")`. The REAL core router holds the named route; the page
 * handler's `clientApiRouteNames` (the function every render calls) must answer
 * with it on both sites.
 */

const router = Router.getInstance();
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const route of router.list()) {
    if (route.sourceFile !== undefined) router.removeRoutesBySourceFile(route.sourceFile);
  }

  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
  }

  container.delete("http.server");
  vi.restoreAllMocks();
});

const PAGE = `import { apiHref } from "@warlock.js/web";

export default function Page() {
  return <a href={apiHref("ping.show")}>ping</a>;
}
`;

function makeTwoSiteApp(siteKeys: string[]) {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-multi-site-dev-"));
  temporaryDirectories.push(appRoot);
  const appSrcRoot = path.join(appRoot, "src");
  const files: Record<string, { root: string; page: string }> = {};

  for (const site of siteKeys) {
    const directory = path.join(appSrcRoot, "web", "$sites", site);
    const root = path.join(directory, "root.tsx");
    const page = path.join(directory, "index.page.tsx");

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(root, "export default function Root() { return null; }\n");
    fs.writeFileSync(page, PAGE);
    files[site] = { root, page };
  }

  return { appRoot, appSrcRoot, files };
}

describe("multi-site development page installer", () => {
  it("answers each site's named route lookup from core's router, not the site facade", async () => {
    const sites: SitesConfig = {
      landing: { hosts: ["landing.test"] },
      client: { hosts: ["client.test"] },
    };
    const app = makeTwoSiteApp(Object.keys(sites));

    router.get("/api/ping", () => undefined, { name: "ping.show" });

    const built: PageRouteHandlerOptions[] = [];

    vi.spyOn(createPageRouteHandlerModule, "createPageRouteHandler").mockImplementation(
      (options: PageRouteHandlerOptions): PageRouteHandler => {
        built.push(options);

        return async () => undefined;
      },
    );

    const known = new Set(Object.values(app.files).flatMap((entry) => [entry.root, entry.page]));
    const vite = {
      ssrLoadModule: vi.fn(async (id: string) => {
        if (known.has(id)) return { default: () => null };

        throw new Error(`unexpected module: ${id}`);
      }),
    } as unknown as InstallPageRoutesOptions["vite"];

    container.set("http.server", { addHook: vi.fn() } as never);

    await installPageRoutes({
      router,
      vite,
      appRoot: app.appRoot,
      appSrcRoot: app.appSrcRoot,
      appFile: path.join(app.appSrcRoot, "web", "root.tsx"),
      siteDispatch: { dispatch: createSiteDispatch({ sites }), sites },
    });

    for (const [site, entry] of Object.entries(app.files)) {
      const handler = built.find((options) => options.pageFile === entry.page);

      expect(handler, `a page handler for the ${site} site`).toBeDefined();
      expect(handler?.clientApiRouteNames).toBeTypeOf("function");
      expect(handler?.clientApiRouteNames?.(), `${site} route names`).toContain("ping.show");
    }
  });

  it("does not need the route registry when no page names a route", async () => {
    const sites: SitesConfig = { landing: { hosts: ["landing.test"] } };
    const app = makeTwoSiteApp(["landing"]);
    const page = app.files.landing?.page as string;

    fs.writeFileSync(page, "export default function Page() { return null; }\n");

    const built: PageRouteHandlerOptions[] = [];

    vi.spyOn(createPageRouteHandlerModule, "createPageRouteHandler").mockImplementation(
      (options: PageRouteHandlerOptions): PageRouteHandler => {
        built.push(options);

        return async () => undefined;
      },
    );

    const vite = {
      ssrLoadModule: vi.fn(async () => ({ default: () => null })),
    } as unknown as InstallPageRoutesOptions["vite"];

    container.set("http.server", { addHook: vi.fn() } as never);

    await installPageRoutes({
      router,
      vite,
      appRoot: app.appRoot,
      appSrcRoot: app.appSrcRoot,
      appFile: path.join(app.appSrcRoot, "web", "root.tsx"),
      siteDispatch: { dispatch: createSiteDispatch({ sites }), sites },
    });

    const handler = built.find((options) => options.pageFile === page);

    expect(() => handler?.clientApiRouteNames?.()).not.toThrow();
  });
});
