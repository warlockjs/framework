import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageManifest } from "./page-manifest";
import type { SiteDispatchInstall } from "./site-dispatch";

const installPageRoutesFromManifest = vi.fn((_options: unknown) => []);

// The installer names these modules directly, not the `./index` barrel, which also
// re-exports the development installer.
vi.mock("../shared", () => ({ connectSharedStore: vi.fn() }));
vi.mock("./execute-page-request", () => ({ connectPageContext: vi.fn() }));
vi.mock("./install-page-routes-from-manifest", () => ({ installPageRoutesFromManifest }));

afterEach(() => {
  installPageRoutesFromManifest.mockClear();
});

describe("installProductionPageRoutes", () => {
  it("forwards the multi-site dispatcher, so production installs per site", async () => {
    const { installProductionPageRoutes } = await import("./install-production-page-routes");
    const siteDispatch = { sites: {}, dispatch: {} } as unknown as SiteDispatchInstall;

    await installProductionPageRoutes({
      router: {} as never,
      manifest: { pages: [{}] } as unknown as PageManifest,
      pageContext: {} as never,
      sharedStore: () => undefined as never,
      resolveHydrationClientModuleUrl: () => "/assets/hydration-landing.js",
      siteDispatch,
    });

    expect(installPageRoutesFromManifest).toHaveBeenCalledWith(
      expect.objectContaining({ siteDispatch }),
    );
  });
});
