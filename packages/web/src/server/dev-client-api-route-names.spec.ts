import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "@warlock.js/core";
import type { SitesConfig } from "../sites/site-config.types";
import { devClientApiRouteNames } from "./dev-client-api-route-names";
import { installPageRoutes, type InstallPageRoutesOptions } from "./install-page-routes";
import * as devNames from "./dev-client-api-route-names";
import { createSiteDispatch, siteRegistrationRouter } from "./site-dispatch";

const router = Router.getInstance();
const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    fs.rmSync(directories.pop() as string, { recursive: true, force: true });
  }

  vi.restoreAllMocks();
});

function fixture() {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-dev-names-"));
  directories.push(appRoot);
  const appSrcRoot = path.join(appRoot, "src");
  const appFile = path.join(appSrcRoot, "web", "root.tsx");
  const pageFile = path.join(appSrcRoot, "web", "index.page.tsx");

  fs.mkdirSync(path.dirname(pageFile), { recursive: true });
  fs.writeFileSync(appFile, "export default function Root() { return null; }\n", "utf-8");
  fs.writeFileSync(pageFile, "export default function Page() { return null; }\n", "utf-8");

  return { appRoot, appSrcRoot, appFile, pageFile };
}

describe("devClientApiRouteNames", () => {
  it("reads the route names from the registry it is given", () => {
    const files = fixture();
    const registry = { getNamedApiRoutes: vi.fn(() => []) };
    const names = devClientApiRouteNames({
      registry,
      appSrcRoot: files.appSrcRoot,
      appFile: files.appFile,
      pageFile: files.pageFile,
    });

    expect(names()).toEqual([]);
    expect(registry.getNamedApiRoutes).toHaveBeenCalled();
  });

  it("refuses a site registration router, which has no route registry", () => {
    const files = fixture();
    const sites: SitesConfig = { store: { hosts: ["store.test"] } };
    const facade = siteRegistrationRouter(createSiteDispatch({ sites }), "store", "");

    expect(() =>
      devClientApiRouteNames({
        // @ts-expect-error the facade is not a named-route registry
        registry: { get: facade.get, post: facade.post },
        appSrcRoot: files.appSrcRoot,
        appFile: files.appFile,
        pageFile: files.pageFile,
      }),
    ).toThrow(/getNamedApiRoutes/);
  });
});

describe("installPageRoutes multi-site named route source", () => {
  it("hands every page Core's real router as the named route registry, never the site facade", async () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-dev-names-sites-"));
    directories.push(appRoot);
    const appSrcRoot = path.join(appRoot, "src");
    const rootFile = path.join(appSrcRoot, "web", "$sites", "store", "root.tsx");
    const pageFile = path.join(appSrcRoot, "web", "$sites", "store", "index.page.tsx");

    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(rootFile, "export default function Root() { return null; }\n", "utf-8");
    fs.writeFileSync(pageFile, "export default function Page() { return null; }\n", "utf-8");

    const sites: SitesConfig = { store: { hosts: ["store.test"] } };
    const dispatch = createSiteDispatch({ sites });
    const spy = vi.spyOn(devNames, "devClientApiRouteNames");
    const vite: InstallPageRoutesOptions["vite"] = {
      ssrLoadModule: vi.fn(async () => ({ default: () => null })),
    } as never;

    try {
      await installPageRoutes({
        router,
        vite,
        appRoot,
        appSrcRoot,
        appFile: path.join(appSrcRoot, "web", "root.tsx"),
        siteDispatch: { dispatch, sites },
      });
    } finally {
      for (const route of router.list()) {
        if (route.sourceFile !== undefined) router.removeRoutesBySourceFile(route.sourceFile);
      }
    }

    expect(spy).toHaveBeenCalled();

    for (const [input] of spy.mock.calls) {
      expect(input.registry).toBe(router);
      expect(typeof input.registry.getNamedApiRoutes).toBe("function");
    }
  });
});
