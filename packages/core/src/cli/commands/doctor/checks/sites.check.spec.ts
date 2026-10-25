import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import { container } from "../../../../container";
import { router } from "../../../../router/router";
import type { DoctorBootContext } from "../check.types";
import {
  type InjectableServer,
  listSiteTargets,
  parseDevErrorPanel,
  renderSiteRoot,
  sitesCheck,
} from "./sites.check";

const PANEL = `<html><body><aside data-warlock-dev-error="" style="margin:1rem"><strong>TypeError: input.router.getNamedApiRoutes is not a function</strong><dl style="margin:0.5rem 0"><dt style="font-weight:bold">Phase</dt><dd style="margin:0 0 0.25rem 0">render</dd><dt style="font-weight:bold">Page file</dt><dd style="margin:0">src/web/$sites/landing/index.page.tsx</dd><dt>Route</dt><dd>/</dd><dt>Site</dt><dd>landing</dd></dl><pre>stack</pre></aside></body></html>`;

function context(booted: string[] = ["http", "web"]): DoctorBootContext {
  return {
    booted: true,
    connectors: { booted, registered: booted, configured: [], skipped: [], failures: [] },
  } as unknown as DoctorBootContext;
}

type Answer = { statusCode: number; body?: string; contentType?: string };

function fakeServer(answers: Record<string, Answer | Error>): InjectableServer & {
  requests: Array<{ url: string; host: string | undefined }>;
} {
  const requests: Array<{ url: string; host: string | undefined }> = [];

  return {
    requests,
    inject: async ({ url, headers }) => {
      requests.push({ url, host: headers.host });

      const answer = answers[headers.host ?? ""] ?? { statusCode: 200 };

      if (answer instanceof Error) throw answer;

      return {
        statusCode: answer.statusCode,
        body: answer.body ?? "",
        headers: { "content-type": answer.contentType ?? "text/html" },
      };
    },
  };
}

describe("listSiteTargets", () => {
  it("takes each fixed site's first host and its root path", () => {
    expect(
      listSiteTargets({
        landing: { hosts: ["landing.test", "www.landing.test"] },
        admin: { hosts: ["admin.test"], basePath: "/admin/" },
        tenants: { dynamic: true },
      }),
    ).toEqual({
      targets: [
        { site: "landing", host: "landing.test", path: "/" },
        { site: "admin", host: "admin.test", path: "/admin" },
      ],
      dynamic: ["tenants"],
    });
  });

  it("returns nothing for a missing or malformed config", () => {
    expect(listSiteTargets(undefined)).toEqual({ targets: [], dynamic: [] });
    expect(listSiteTargets("sites")).toEqual({ targets: [], dynamic: [] });
    expect(listSiteTargets({ broken: { hosts: [] } })).toEqual({ targets: [], dynamic: [] });
  });
});

describe("parseDevErrorPanel", () => {
  it("reads the message, phase, page file and route", () => {
    expect(parseDevErrorPanel(PANEL)).toEqual({
      message: "TypeError: input.router.getNamedApiRoutes is not a function",
      phase: "render",
      file: "src/web/$sites/landing/index.page.tsx",
      route: "/",
    });
  });

  it("decodes escaped characters", () => {
    const panel = `<aside data-warlock-dev-error><strong>Error: a &lt;b&gt; &amp; &quot;c&quot; &#x27;d&#x27;</strong></aside>`;

    expect(parseDevErrorPanel(panel).message).toBe(`Error: a <b> & "c" 'd'`);
  });

  it("returns nothing for a body without the panel", () => {
    expect(parseDevErrorPanel("<html>ok</html>")).toEqual({});
  });
});

describe("renderSiteRoot", () => {
  const target = { site: "landing", host: "landing.test", path: "/" };

  it("requests the site's path with its host and reports the status", async () => {
    const server = fakeServer({});

    expect(await renderSiteRoot(server, target)).toEqual({ target, status: 200 });
    expect(server.requests).toEqual([{ url: "/", host: "landing.test" }]);
  });

  it("does not treat a redirect or a 404 as a failure", async () => {
    expect(
      (await renderSiteRoot(fakeServer({ "landing.test": { statusCode: 302 } }), target)).failure,
    ).toBeUndefined();
    expect(
      (await renderSiteRoot(fakeServer({ "landing.test": { statusCode: 404 } }), target)).failure,
    ).toBeUndefined();
  });

  it("names the phase and file of a 5xx from the page error panel", async () => {
    const outcome = await renderSiteRoot(
      fakeServer({ "landing.test": { statusCode: 500, body: PANEL } }),
      target,
    );

    expect(outcome.failure).toContain('500 in phase "render"');
    expect(outcome.failure).toContain("src/web/$sites/landing/index.page.tsx");
    expect(outcome.failure).toContain("getNamedApiRoutes is not a function");
  });

  it("reads a JSON error message when there is no panel", async () => {
    const outcome = await renderSiteRoot(
      fakeServer({
        "landing.test": {
          statusCode: 503,
          body: '{"message":"db down"}',
          contentType: "application/json",
        },
      }),
      target,
    );

    expect(outcome.failure).toContain("503");
    expect(outcome.failure).toContain("db down");
  });

  it("reports a request that throws or never answers", async () => {
    const thrown = await renderSiteRoot(fakeServer({ "landing.test": new Error("boom") }), target);
    expect(thrown.failure).toContain("boom");

    const hung: InjectableServer = { inject: () => new Promise(() => undefined) };
    const timedOut = await renderSiteRoot(hung, target, 10);
    expect(timedOut.failure).toContain("no answer within");
  });
});

describe("doctor sites check", () => {
  beforeEach(() => {
    vi.spyOn(router, "scanDevServer").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setConfig("web", undefined as unknown as never);
    container.delete("http.server");
  });

  function configure(sites: Record<string, unknown>, server: InjectableServer) {
    setConfig("web", { sites } as never);
    container.set("http.server", server as never);
  }

  it("opts out for a single-site app", async () => {
    setConfig("web", {} as never);

    expect(await sitesCheck.run(context())).toBeUndefined();
  });

  it("opts out when the web or http connector did not boot", async () => {
    configure({ landing: { hosts: ["landing.test"] } }, fakeServer({}));

    expect(await sitesCheck.run(context(["http"]))).toBeUndefined();
    expect(await sitesCheck.run(context(["web"]))).toBeUndefined();
  });

  it("opts out when every site is dynamic", async () => {
    configure({ tenants: { dynamic: true } }, fakeServer({}));

    expect(await sitesCheck.run(context())).toBeUndefined();
  });

  it("scans the router like the dev server and renders each site once", async () => {
    const server = fakeServer({});
    configure(
      {
        landing: { hosts: ["landing.test"] },
        client: { hosts: ["client.test"], basePath: "/app" },
      },
      server,
    );

    const result = await sitesCheck.run(context());

    expect(router.scanDevServer).toHaveBeenCalledTimes(1);
    expect(server.requests).toEqual([
      { url: "/", host: "landing.test" },
      { url: "/app", host: "client.test" },
    ]);
    expect(result).toMatchObject({ name: "sites", status: "ok" });
    expect(result?.detail).toContain("landing 200, client 200");
  });

  it("fails with the site, phase and file when a site answers 500", async () => {
    configure(
      { landing: { hosts: ["landing.test"] }, client: { hosts: ["client.test"] } },
      fakeServer({ "client.test": { statusCode: 500, body: PANEL } }),
    );

    const result = await sitesCheck.run(context());

    expect(result).toMatchObject({ status: "fail", code: "WL5005" });
    expect(result?.detail).toContain("1 of 2 site(s)");
    expect(result?.detail).toContain("client (GET / on client.test)");
    expect(result?.detail).toContain('phase "render"');
    expect(result?.detail).not.toContain("landing (GET");
  });

  it("mentions dynamic sites it could not render", async () => {
    configure({ landing: { hosts: ["landing.test"] }, tenants: { dynamic: true } }, fakeServer({}));

    expect((await sitesCheck.run(context()))?.detail).toContain("tenants");
  });

  it("fails when the router cannot be bound", async () => {
    vi.spyOn(router, "scanDevServer").mockImplementation(() => {
      throw new Error("duplicate route");
    });
    configure({ landing: { hosts: ["landing.test"] } }, fakeServer({}));

    const result = await sitesCheck.run(context());

    expect(result).toMatchObject({ status: "fail", code: "WL5005" });
    expect(result?.detail).toContain("duplicate route");
  });
});
