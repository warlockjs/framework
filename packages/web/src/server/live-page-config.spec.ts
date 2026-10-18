import { describe, expect, it, vi } from "vitest";
import { readModuleConfig } from "../build/read-module-config";
import { isHydrationPayload } from "../hydration-payload";
import { buildHydrationPayload } from "./build-hydration-payload";
import { normalizePageModule } from "./normalize-page-module";
import { resolvePageCacheHitOrMiss } from "./page-route-handler/serve-page-cache-hit";

describe("live page configuration", () => {
  it("accepts page-owned dependency tags at build time and in runtime normalization", () => {
    expect(
      readModuleConfig(
        "products.page.tsx",
        `
      export const config = { live: { tags: ["products"], pollInterval: 5000 } };
      export default function Page() { return null; }
    `,
        "page",
      ),
    ).toMatchObject({ hasConfig: true });
    const live = { tags: ["products"], pollInterval: 5000 };
    expect(
      normalizePageModule({ default: () => null, config: { live } }, "page", "products.page.tsx")
        .live,
    ).toEqual(live);
  });

  it.each([
    {},
    { tags: [] },
    { tags: [""] },
    { tags: [1] },
    { tags: ["products"], pollInterval: 0 },
    { tags: ["products"], pollInterval: Infinity },
    { tags: ["products"], extra: true },
  ])("refuses invalid live options %j", (live) => {
    expect(() =>
      normalizePageModule({ default: () => null, config: { live } }, "page", "products.page.tsx"),
    ).toThrow("config.live");
  });

  it("carries the same live policy on document and data payloads, refusing malformed wire options", () => {
    const live = { tags: ["products"] };
    const payload = buildHydrationPayload(
      { route: { name: "products", path: "/products", params: {}, query: {} }, live },
      "en",
    );
    expect(payload.live).toEqual(live);
    expect(isHydrationPayload(payload)).toBe(true);
    expect(isHydrationPayload({ ...payload, live: { tags: "products" } })).toBe(false);
    expect(isHydrationPayload({ ...payload, live: undefined })).toBe(true);
  });

  it("bypasses cached bytes and storage for live requests", async () => {
    const header = vi.fn();
    const outcome = await resolvePageCacheHitOrMiss({
      request: { header: (name: string) => (name === "x-warlock-live" ? "1" : undefined) } as never,
      response: { header } as never,
      cache: { public: true, serverCache: true, maxAge: 60, tags: ["products"] },
      credentialedRequest: false,
      pageCacheVariant: "json",
    });
    expect(outcome).toEqual({
      served: false,
      cacheHeaderValue: "bypass",
      cacheKey: undefined,
      attemptStorageAfterRender: false,
    });
    expect(header).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });
});
