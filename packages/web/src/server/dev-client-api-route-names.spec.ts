import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router, container } from "@warlock.js/core";
import type { SitesConfig } from "../sites/site-config.types";
import { devClientApiRouteNames } from "./dev-client-api-route-names";
import { installPageRoutes, type InstallPageRoutesOptions } from "./install-page-routes";
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

    const names = devClientApiRouteNames({
      // @ts-expect-error the facade is not a named-route registry
      registry: { get: facade.get, post: facade.post },
      appSrcRoot: files.appSrcRoot,
      appFile: files.appFile,
      pageFile: files.pageFile,
    });

    expect(() => names()).toThrow(/getNamedApiRoutes/);
  });
});

describe("installPageRoutes multi-site named route source", () => {
  it("installs a multi-site tree against Core's real router without touching the site facade's missing registry", async () => {
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
    const vite: InstallPageRoutesOptions["vite"] = {
      ssrLoadModule: vi.fn(async () => ({ default: () => null })),
    } as never;

    container.set("http.server", { addHook: vi.fn() } as never);

    try {
      await expect(
        installPageRoutes({
          router,
          vite,
          appRoot,
          appSrcRoot,
          appFile: path.join(appSrcRoot, "web", "root.tsx"),
          siteDispatch: { dispatch, sites },
        }),
      ).resolves.toBeDefined();
    } finally {
      container.delete("http.server");

      for (const route of router.list()) {
        if (route.sourceFile !== undefined) router.removeRoutesBySourceFile(route.sourceFile);
      }
    }
  });
});
