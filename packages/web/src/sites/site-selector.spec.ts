import { describe, expect, it, vi } from "vitest";
import type { HostResolution, SitesConfig } from "./site-config.types";
import { createSiteSelector, validateSitesAtBoot } from "./site-selector";

const request = {} as never;
const at = (rawHost: string, path = "/") => ({ rawHost, path, request });

const fixed: SitesConfig = {
  landing: { hosts: ["estates.app", "www.estates.app"] },
  platform: { hosts: ["app.estates.app"] },
};

describe("createSiteSelector", () => {
  it("selects by exact host", async () => {
    const { select } = createSiteSelector({ sites: fixed });
    expect(await select(at("app.estates.app"))).toEqual({
      kind: "site",
      site: "platform",
      host: "app.estates.app",
      basePath: "",
    });
  });

  it("matches a listed www alias but not an unlisted one", async () => {
    const { select } = createSiteSelector({ sites: fixed });
    expect((await select(at("www.estates.app"))).kind).toBe("site");
    expect(await select(at("www.app.estates.app"))).toEqual({
      kind: "not-found",
      host: "www.app.estates.app",
    });
  });

  it("normalises uppercase and port", async () => {
    const { select } = createSiteSelector({ sites: fixed });
    expect(await select(at("APP.Estates.App:443"))).toMatchObject({
      site: "platform",
      host: "app.estates.app",
    });
  });

  it("picks the longest basePath on segment boundaries", async () => {
    const sites: SitesConfig = {
      main: { hosts: ["acme.com"] },
      admin: { hosts: ["acme.com"], basePath: "/admin" },
      deep: { hosts: ["acme.com"], basePath: "/admin/deep" },
    };
    const { select } = createSiteSelector({ sites });
    const site = async (p: string) => ((await select(at("acme.com", p))) as { site: string }).site;
    expect(await site("/admin")).toBe("admin");
    expect(await site("/admin/x")).toBe("admin");
    expect(await site("/admin/deep/y")).toBe("deep");
    expect(await site("/administrator")).toBe("main");
    expect(await select(at("acme.com", "/admin/deep"))).toMatchObject({ basePath: "/admin/deep" });
  });

  it("calls the resolver only for unlisted hosts", async () => {
    const resolveHost = vi.fn(() => null);
    const sites: SitesConfig = { ...fixed, tenant: { dynamic: true } };
    const { select } = createSiteSelector({ sites, resolveHost });
    await select(at("estates.app"));
    expect(resolveHost).not.toHaveBeenCalled();
    await select(at("other.com"));
    expect(resolveHost).toHaveBeenCalledWith({ host: "other.com", request });
  });

  it("never calls the resolver for a listed host with a basePath mismatch", async () => {
    const resolveHost = vi.fn(() => null);
    const sites: SitesConfig = {
      admin: { hosts: ["acme.com"], basePath: "/admin" },
      tenant: { dynamic: true },
    };
    const { select } = createSiteSelector({ sites, resolveHost });
    expect(await select(at("acme.com", "/"))).toEqual({ kind: "not-found", host: "acme.com" });
    expect(resolveHost).not.toHaveBeenCalled();
  });

  describe("resolver", () => {
    const sites: SitesConfig = {
      ...fixed,
      tenant: { dynamic: true },
      portal: { dynamic: true, basePath: "/portal" },
    };
    const hit: HostResolution = { site: "tenant", key: "t1" };

    it("null goes to not-found", async () => {
      const { select } = createSiteSelector({ sites, resolveHost: () => null });
      expect(await select(at("x.com"))).toEqual({ kind: "not-found", host: "x.com" });
    });

    it("null goes to unknownHost site", async () => {
      const { select } = createSiteSelector({
        sites,
        resolveHost: () => null,
        unknownHost: "landing",
      });
      expect(await select(at("x.com"))).toMatchObject({
        kind: "site",
        site: "landing",
        host: "x.com",
      });
    });

    it("unknownHost not-found stays not-found", async () => {
      const { select } = createSiteSelector({
        sites,
        resolveHost: () => null,
        unknownHost: "not-found",
      });
      expect((await select(at("x.com"))).kind).toBe("not-found");
    });

    it("rejects when the resolver throws", async () => {
      const { select } = createSiteSelector({
        sites,
        resolveHost: async () => {
          throw new Error("db down");
        },
        unknownHost: "landing",
      });
      await expect(select(at("x.com"))).rejects.toThrow("db down");
    });

    it("throws for an invalid resolved site", async () => {
      const { select } = createSiteSelector({
        sites,
        resolveHost: () => ({ site: "landing", key: "k" }),
      });
      await expect(select(at("x.com"))).rejects.toThrow(/not a dynamic site/);
    });

    it("honours a resolved site's basePath", async () => {
      const resolution: HostResolution = { site: "portal", key: "p" };
      const { select } = createSiteSelector({ sites, resolveHost: () => resolution });
      expect(await select(at("x.com", "/portal/a"))).toEqual({
        kind: "site",
        site: "portal",
        host: "x.com",
        basePath: "/portal",
        resolution,
      });
      expect((await select(at("x.com", "/portalx"))).kind).toBe("not-found");
      expect((await select(at("x.com", "/"))).kind).toBe("not-found");
    });

    describe("cache", () => {
      const setup = (fn: () => HostResolution | null | Promise<HostResolution | null>) => {
        let now = 0;
        const resolveHost = vi.fn(fn);
        const selector = createSiteSelector({
          sites,
          resolveHost,
          resolveCache: { ttl: 10 },
          now: () => now,
        });
        return { resolveHost, selector, advance: (ms: number) => (now += ms) };
      };

      it("hits within ttl and expires after", async () => {
        const { resolveHost, selector, advance } = setup(() => hit);
        await selector.select(at("x.com"));
        advance(9_999);
        await selector.select(at("x.com", "/other"));
        expect(resolveHost).toHaveBeenCalledTimes(1);
        advance(1);
        await selector.select(at("x.com"));
        expect(resolveHost).toHaveBeenCalledTimes(2);
      });

      it("caches null", async () => {
        const { resolveHost, selector } = setup(() => null);
        await selector.select(at("x.com"));
        await selector.select(at("x.com"));
        expect(resolveHost).toHaveBeenCalledTimes(1);
      });

      it("forget drops the entry", async () => {
        const { resolveHost, selector } = setup(() => hit);
        await selector.select(at("x.com"));
        selector.forget("X.com:80");
        await selector.select(at("x.com"));
        expect(resolveHost).toHaveBeenCalledTimes(2);
      });

      it("does not cache errors", async () => {
        let fail = true;
        const { resolveHost, selector } = setup(() => {
          if (fail) throw new Error("boom");
          return hit;
        });
        await expect(selector.select(at("x.com"))).rejects.toThrow("boom");
        fail = false;
        expect((await selector.select(at("x.com"))).kind).toBe("site");
        expect(resolveHost).toHaveBeenCalledTimes(2);
      });
    });
  });

  it("does not cache without resolveCache", async () => {
    const resolveHost = vi.fn(() => null);
    const sites: SitesConfig = { ...fixed, tenant: { dynamic: true } };
    const { select } = createSiteSelector({ sites, resolveHost });
    await select(at("x.com"));
    await select(at("x.com"));
    expect(resolveHost).toHaveBeenCalledTimes(2);
  });
});

describe("Real-Estate config", () => {
  const sites: SitesConfig = {
    landing: { hosts: ["estates.app", "www.estates.app"] },
    platform: { hosts: ["app.estates.app"] },
    tenant: { dynamic: true },
    tenantAdmin: { dynamic: true },
  };
  const resolveHost = ({ host }: { host: string }): HostResolution | null => {
    if (host === "acme.com") return { site: "tenant", key: "acme" };
    if (host === "admin.acme.com") return { site: "tenantAdmin", key: "acme" };
    return null;
  };
  const { select } = createSiteSelector({ sites, resolveHost });

  it.each([
    ["estates.app", "landing"],
    ["app.estates.app", "platform"],
    ["acme.com", "tenant"],
    ["admin.acme.com", "tenantAdmin"],
  ])("%s -> %s", async (host, site) => {
    expect(await select(at(host))).toMatchObject({ kind: "site", site });
  });

  it("evil.com -> not-found", async () => {
    expect(await select(at("evil.com"))).toEqual({ kind: "not-found", host: "evil.com" });
  });
});

describe("validateSitesAtBoot", () => {
  it("passes a valid config", () => {
    expect(() => validateSitesAtBoot({ sites: fixed })).not.toThrow();
  });

  it("throws one error listing every problem, including resolver codes", () => {
    const sites: SitesConfig = {
      a: { dynamic: true },
      b: { hosts: ["b.com"], basePath: "/" },
    };
    expect(() => validateSitesAtBoot({ sites })).toThrow(
      /SITE_BASEPATH_INVALID[\s\S]*DYNAMIC_SITE_WITHOUT_RESOLVER/,
    );
    expect(() => validateSitesAtBoot({ sites: fixed, resolveHost: () => null })).toThrow(
      /RESOLVER_WITHOUT_DYNAMIC_SITE/,
    );
  });
});

describe("createSiteSelector resolveCache bound", () => {
  const dynamicSites: SitesConfig = { tenant: { dynamic: true } };

  it("remembers at most maxEntries hosts however many distinct hosts arrive", async () => {
    const resolveHost = vi.fn(async () => null);
    const { select } = createSiteSelector({
      sites: dynamicSites,
      resolveHost,
      resolveCache: { ttl: 60, maxEntries: 100 },
    });

    for (let n = 0; n < 1_000; n++) await select(at(`random-${n}.example`));
    resolveHost.mockClear();

    // The 100 most recent hosts are still remembered; the first ones were dropped.
    await select(at("random-999.example"));
    await select(at("random-900.example"));
    expect(resolveHost).not.toHaveBeenCalled();

    await select(at("random-0.example"));
    expect(resolveHost).toHaveBeenCalledTimes(1);
  });

  it("drops the least recently used host first", async () => {
    const resolveHost = vi.fn(async ({ host }: { host: string }) => ({
      site: "tenant",
      key: host,
    }));
    const { select } = createSiteSelector({
      sites: dynamicSites,
      resolveHost,
      resolveCache: { ttl: 60, maxEntries: 2 },
    });

    await select(at("a.example"));
    await select(at("b.example"));
    await select(at("a.example")); // a is now the most recent
    await select(at("c.example")); // evicts b
    resolveHost.mockClear();

    await select(at("a.example"));
    expect(resolveHost).not.toHaveBeenCalled();

    await select(at("b.example"));
    expect(resolveHost).toHaveBeenCalledWith({ host: "b.example", request });
  });

  it("sweeps expired hosts before evicting live ones", async () => {
    let now = 0;
    const resolveHost = vi.fn(async ({ host }: { host: string }) => ({
      site: "tenant",
      key: host,
    }));
    const { select } = createSiteSelector({
      sites: dynamicSites,
      resolveHost,
      resolveCache: { ttl: 10, maxEntries: 2 },
      now: () => now,
    });

    await select(at("old.example"));
    now = 5_000;
    await select(at("live.example"));
    now = 6_000;
    await select(at("old.example")); // a hit: old.example is now the most recent
    now = 11_000; // old.example has expired; live.example (least recent) has not
    await select(at("new.example"));
    resolveHost.mockClear();

    await select(at("live.example"));
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it("never sends a host longer than a DNS name to the resolver", async () => {
    const resolveHost = vi.fn(async () => ({ site: "tenant", key: "x" }));
    const { select } = createSiteSelector({ sites: dynamicSites, resolveHost });

    expect((await select(at(`${"a".repeat(254)}.example`))).kind).toBe("not-found");
    expect(resolveHost).not.toHaveBeenCalled();
  });
});
