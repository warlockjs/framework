import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createCollector } from "../../../src/collector";
import { resolveDevtoolsOptions } from "../../../src/options";
import { checkDevtoolsPanels } from "../../../src/panels";
import { mountDevtoolsRoutes } from "../../../src/server";
import { instance, testPanel } from "./harness";

const servers: ReturnType<typeof Fastify>[] = [];
const local = { remoteAddress: "127.0.0.1", headers: { host: "localhost:3000" } };

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

function mount(extra: Record<string, unknown> = {}) {
  const options = resolveDevtoolsOptions();
  const server = Fastify();

  servers.push(server);
  mountDevtoolsRoutes(server, {
    collector: createCollector(options),
    options,
    isDevelopment: () => true,
    panels: [testPanel({ production: undefined as never })],
    ...extra,
  });

  return server;
}

describe("the development dashboard's session and panel routes", () => {
  it("answers the development session view: signed in as an admin, no accounts", async () => {
    const response = await mount().inject({ url: "/__warlock/api/auth/session", ...local });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: "development",
      stage: "active",
      account: null,
      role: "admin",
      csrf: null,
      expiresAt: null,
      instance: null,
      methods: null,
      share: null,
    });
  });

  it("includes the instance once the insights are wired", async () => {
    const response = await mount({ instance }).inject({
      url: "/__warlock/api/auth/session",
      ...local,
    });

    expect(response.json()).toMatchObject({ instance: { id: "host:1:abc" } });
  });

  it("lists every built-in tab and then the panels", async () => {
    const response = await mount().inject({ url: "/__warlock/api/panels", ...local });
    const tabs = response.json<{ id: string; type: string }[]>();

    expect(tabs.slice(0, 12).map((tab) => tab.id)).toEqual([
      "requests",
      "queries",
      "routes",
      "resources",
      "health",
      "errors",
      "logs",
      "jobs",
      "mail",
      "ai",
      "agents",
      "api",
    ]);
    expect(tabs.slice(12)).toEqual([
      { id: "processes", title: "Processes", type: "package", shareable: false },
      { id: "test-panel", title: "Test panel", type: "package", shareable: false },
    ]);
  });

  it("keeps both routes behind the loopback guard", async () => {
    const server = mount();

    for (const url of ["/__warlock/api/auth/session", "/__warlock/api/panels"]) {
      const response = await server.inject({
        url,
        remoteAddress: "203.0.113.9",
        headers: { host: "localhost" },
      });

      expect(response.statusCode, url).toBe(404);
    }
  });

  it("is not changed by checking panels for the production flag", () => {
    expect(
      checkDevtoolsPanels([{ id: "plain", title: "Plain", view: testPanel().view }])[0]?.production,
    ).toBe(false);
  });
});
