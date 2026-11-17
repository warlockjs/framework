import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevtoolsProductionConfigError } from "../../../src/production/errors";

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const stops = {
    attach: vi.fn(),
    resources: vi.fn(),
    health: vi.fn(),
    writer: vi.fn(async () => undefined),
    exclusion: vi.fn(),
    dispose: vi.fn(async () => undefined),
  };
  const store = {
    verify: vi.fn(async () => {
      calls.push("verify");
    }),
  };
  const capture = {
    collector: { subscribe: () => () => undefined },
    queries: { id: "queries" },
    routes: { id: "routes" },
    errors: { id: "errors" },
    logs: { id: "logs" },
    requests: {},
    counters: () => ({ requests: 0 }),
    attach: vi.fn(async () => {
      calls.push("attach");

      return stops.attach;
    }),
    explain: vi.fn(),
    flush: vi.fn(),
    dispose: stops.dispose,
  };

  return {
    calls,
    stops,
    store,
    capture,
    ensureFirstAdmin: vi.fn(async () => {
      calls.push("ensureFirstAdmin");
    }),
    createStore: vi.fn(async () => {
      calls.push("createStore");

      return store;
    }),
    createCapture: vi.fn((..._args: unknown[]) => {
      calls.push("createCapture");

      return capture;
    }),
    createAuth: vi.fn((..._args: unknown[]) => ({ ensureFirstAdmin: h.ensureFirstAdmin })),
    mount: vi.fn((..._args: unknown[]) => {
      calls.push("mount");
    }),
    core: {
      Application: { runtimeStrategy: "production" },
      getHttpServer: vi.fn(() => ({ fastify: true })),
      config: { get: vi.fn() as (key: string) => unknown },
      excludeFromRequestLog: vi.fn((..._args: unknown[]) => {
        calls.push("exclude");

        return stops.exclusion;
      }),
    },
  };
});

vi.mock("@warlock.js/core", () => h.core);
vi.mock("@warlock.js/cascade", () => ({}));
vi.mock("@warlock.js/cache", () => ({}));
vi.mock("../../../src/server", () => ({ mountDevtoolsRoutes: vi.fn() }));
vi.mock("../../../src/sources/ai-source", () => ({
  attachAiSource: async () => ({ available: false, message: "", dispose: () => undefined }),
}));
vi.mock("../../../src/production/store", () => ({ createCascadeStore: h.createStore }));
vi.mock("../../../src/production/auth", () => ({
  createDevtoolsAuth: h.createAuth,
  defaultDevtoolsCrypto: async () => ({ crypto: true }),
  loadDevtoolsPasskeys: async () => null,
}));
vi.mock("../../../src/production/capture", () => ({ createProductionCapture: h.createCapture }));
vi.mock("../../../src/production/insights", () => ({
  createInstanceInfo: () => ({ id: "host:1:abc" }),
  createResourceMonitor: () => ({
    start: () => h.calls.push("resources"),
    stop: h.stops.resources,
  }),
  createHealthHistory: () => ({ start: () => h.calls.push("health"), stop: h.stops.health }),
  createJobsReader: () => async () => ({}),
  createLocalReporter: () => ({ reporter: true }),
  startReportWriter: () => ({ stop: h.stops.writer }),
  createSharedInsights: () => ({ insights: true }),
}));
vi.mock("../../../src/production/http", async (original) => ({
  ...(await original<typeof import("../../../src/production/http")>()),
  mountProductionDevtools: h.mount,
}));

import { bootProductionDevtools, maskDashboardPath } from "../../../src/production/boot";
import { resolveDevtoolsOptions } from "../../../src/options";
import { checkDevtoolsPanels } from "../../../src/panels";
import { testPanel } from "./harness";

const KEY = "ab".repeat(32);
const SECRET_PATH = "/ops-7f3k2q9x";
const configured: Record<string, unknown> = {};

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function input(overrides: Partial<Parameters<typeof bootProductionDevtools>[0]> = {}) {
  return {
    options: resolveDevtoolsOptions({ production: { enabled: true } }),
    env: { DEVTOOLS_PATH: SECRET_PATH },
    server: { fastify: true } as never,
    panels: [],
    routes: {},
    readConfig: (key: string) => (key === "encryption.key" ? KEY : undefined),
    log: logger(),
    ...overrides,
  } satisfies Parameters<typeof bootProductionDevtools>[0];
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;

    return null;
  } catch (error) {
    return error instanceof DevtoolsProductionConfigError ? error.code : `other:${String(error)}`;
  }
}

beforeEach(() => {
  h.calls.length = 0;
  for (const mock of [
    ...Object.values(h.stops),
    h.store.verify,
    h.createStore,
    h.createCapture,
    h.createAuth,
    h.ensureFirstAdmin,
    h.mount,
    h.capture.attach,
    h.core.excludeFromRequestLog,
  ]) {
    mock.mockClear();
  }
  h.core.config.get = vi.fn((key: string) => configured[key]);
  h.core.Application.runtimeStrategy = "production";
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const key of Object.keys(configured)) delete configured[key];
});

describe("bootProductionDevtools", () => {
  it("refuses a missing path before touching the database", async () => {
    expect(await codeOf(bootProductionDevtools(input({ env: {} })))).toBe("DT001");
    expect(h.createStore).not.toHaveBeenCalled();
    expect(h.mount).not.toHaveBeenCalled();
  });

  it("refuses a bad path and a bad option before touching the database", async () => {
    expect(
      await codeOf(bootProductionDevtools(input({ env: { DEVTOOLS_PATH: "/__warlock" } }))),
    ).toBe("DT002");
    expect(
      await codeOf(
        bootProductionDevtools(
          input({
            options: resolveDevtoolsOptions({ production: { enabled: true, sampleRate: 9 } }),
          }),
        ),
      ),
    ).toBe("DT007");
    expect(h.createStore).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "short", "z".repeat(64), "ab".repeat(31)])(
    "refuses an encryption key that is not 64 hex characters (%s)",
    async (key) => {
      expect(await codeOf(bootProductionDevtools(input({ readConfig: () => key })))).toBe("DT006");
      expect(h.createStore).not.toHaveBeenCalled();
    },
  );

  it("refuses to boot when there is no admin and no environment admin", async () => {
    h.ensureFirstAdmin.mockRejectedValueOnce(new DevtoolsProductionConfigError("DT003"));

    expect(await codeOf(bootProductionDevtools(input()))).toBe("DT003");
    expect(h.mount).not.toHaveBeenCalled();
    expect(h.createCapture).not.toHaveBeenCalled();
  });

  it("refuses to boot when the tables are missing", async () => {
    h.store.verify.mockRejectedValueOnce(new DevtoolsProductionConfigError("DT008"));

    expect(await codeOf(bootProductionDevtools(input()))).toBe("DT008");
    expect(h.ensureFirstAdmin).not.toHaveBeenCalled();
    expect(h.mount).not.toHaveBeenCalled();
  });

  it("starts in the documented order and mounts last", async () => {
    await bootProductionDevtools(input());

    expect(h.calls).toEqual([
      "createStore",
      "verify",
      "ensureFirstAdmin",
      "createCapture",
      "attach",
      "resources",
      "health",
      "exclude",
      "mount",
    ]);
    expect(h.core.excludeFromRequestLog).toHaveBeenCalledWith(SECRET_PATH);
  });

  it("logs one line with the path masked", async () => {
    const log = logger();

    await bootProductionDevtools(input({ log }));

    expect(log.info).toHaveBeenCalledTimes(1);

    const [module, action, message] = log.info.mock.calls[0] as [string, string, string];

    expect(module).toBe("devtools");
    expect(action).toBe("ready");
    expect(message).toContain("/ops-…");
    expect(message).not.toContain("7f3k2q9x");
    expect(message).not.toContain(SECRET_PATH);

    for (const line of [...log.warn.mock.calls, ...log.error.mock.calls]) {
      expect(String(line)).not.toContain("7f3k2q9x");
    }
  });

  it("masks every kind of path", () => {
    expect(maskDashboardPath("/ops-7f3k2q9x")).toBe("/ops-…");
    expect(maskDashboardPath("/monitoring/area")).toBe("/…");
    expect(maskDashboardPath("/waytoolongprefix-abc")).toBe("/…");
  });

  it("mounts with the panels and tabs the project enabled", async () => {
    const options = resolveDevtoolsOptions({
      production: {
        enabled: true,
        panels: { logs: false, mail: false, shown: false, quiet: true },
      },
    });
    const panels = checkDevtoolsPanels([
      testPanel({ id: "declared", production: true }),
      testPanel({ id: "shown", production: true }),
      testPanel({ id: "quiet", production: false }),
      testPanel({ id: "silent", production: false }),
    ]);

    await bootProductionDevtools(input({ options, panels }));

    const deps = h.mount.mock.calls[0]?.[1] as {
      panels: { id: string }[];
      builtInPanels: string[];
      production: { path: string };
      instance: { id: string };
    };

    expect(deps.panels.map((panel) => panel.id)).toEqual(["declared", "quiet"]);
    expect(deps.builtInPanels).toEqual([
      "requests",
      "queries",
      "routes",
      "resources",
      "health",
      "errors",
      "jobs",
    ]);
    expect(deps.production.path).toBe(SECRET_PATH);
    expect(deps.instance.id).toBe("host:1:abc");
  });

  it("hands the route deps through and adds the production collector", async () => {
    const listRoutes = () => [];

    await bootProductionDevtools(input({ routes: { listRoutes } }));

    const deps = h.mount.mock.calls[0]?.[1] as { routes: Record<string, unknown> };

    expect(deps.routes.listRoutes).toBe(listRoutes);
    expect(deps.routes.collector).toBe(h.capture.collector);
    expect((deps.routes.isDevelopment as () => boolean)()).toBe(false);
  });

  it("returns a disposer that stops everything it started", async () => {
    const dispose = await bootProductionDevtools(input());

    dispose();

    await vi.waitFor(() => expect(h.stops.dispose).toHaveBeenCalled());
    expect(h.stops.attach).toHaveBeenCalled();
    expect(h.stops.resources).toHaveBeenCalled();
    expect(h.stops.health).toHaveBeenCalled();
    expect(h.stops.writer).toHaveBeenCalled();
    expect(h.stops.exclusion).toHaveBeenCalled();

    // A second call stops nothing twice.
    h.stops.writer.mockClear();
    dispose();
    expect(h.stops.writer).not.toHaveBeenCalled();
  });

  it("stops what it started and rethrows when the mount fails", async () => {
    h.mount.mockImplementationOnce(() => {
      throw new Error("mount exploded");
    });

    await expect(bootProductionDevtools(input())).rejects.toThrow("mount exploded");
    await vi.waitFor(() => expect(h.stops.dispose).toHaveBeenCalled());
    expect(h.stops.attach).toHaveBeenCalled();
    expect(h.stops.exclusion).toHaveBeenCalled();
    expect(h.stops.writer).toHaveBeenCalled();
  });
});

describe("the connector in production", () => {
  async function makeConnector(production?: Record<string, unknown>, strategy = "production") {
    h.core.Application.runtimeStrategy = strategy;
    configured.devtools = production === undefined ? {} : { production };
    configured["encryption.key"] = KEY;

    const { devtoolsConnector } = await import("../../../src/devtools-connector");
    const { log } = await import("@warlock.js/logger");

    return { connector: devtoolsConnector(), log };
  }

  it.each([[undefined], [{}], [{ enabled: false }], [{ enabled: "true" }]])(
    "mounts nothing, captures nothing and says so once when production is not enabled (%j)",
    async (production) => {
      vi.stubEnv("DEVTOOLS_PATH", SECRET_PATH);

      const { connector, log } = await makeConnector(production);
      const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);

      await connector.boot();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "devtools",
        "disabled",
        expect.stringContaining("devtools.production.enabled"),
      );
      expect(h.core.getHttpServer).not.toHaveBeenCalled();
      expect(h.createStore).not.toHaveBeenCalled();
      expect(h.createCapture).not.toHaveBeenCalled();
      expect(h.mount).not.toHaveBeenCalled();
      expect(connector.isActive()).toBe(false);
    },
  );

  it("refuses to start when enabled without a path, and stays inactive", async () => {
    vi.stubEnv("DEVTOOLS_PATH", "");

    const { connector } = await makeConnector({ enabled: true });

    await expect(connector.boot()).rejects.toThrow(/\[DT001\]/);
    expect(h.createStore).not.toHaveBeenCalled();
    expect(h.mount).not.toHaveBeenCalled();
    expect(connector.isActive()).toBe(false);
  });

  it("refuses to start without an encryption key", async () => {
    vi.stubEnv("DEVTOOLS_PATH", SECRET_PATH);

    const { connector } = await makeConnector({ enabled: true });

    delete configured["encryption.key"];

    await expect(connector.boot()).rejects.toThrow(/\[DT006\]/);
    expect(h.mount).not.toHaveBeenCalled();
  });

  it("starts the production monitor when enabled and stops it at shutdown", async () => {
    vi.stubEnv("DEVTOOLS_PATH", SECRET_PATH);

    const { connector, log } = await makeConnector({ enabled: true });
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);

    await connector.boot();

    expect(h.mount).toHaveBeenCalledTimes(1);
    expect(h.core.getHttpServer).toHaveBeenCalledTimes(1);
    expect(connector.isActive()).toBe(true);
    expect(info).toHaveBeenCalledWith("devtools", "ready", expect.stringContaining("/ops-…"));
    expect(JSON.stringify(info.mock.calls)).not.toContain("7f3k2q9x");

    const deps = h.mount.mock.calls[0]?.[1] as { panels: { id: string }[] };

    // The Processes panel is off in production unless the project turns it on.
    expect(deps.panels.map((panel) => panel.id)).not.toContain("processes");

    await connector.shutdown();

    await vi.waitFor(() => expect(h.stops.dispose).toHaveBeenCalled());
    expect(connector.isActive()).toBe(false);
  });

  it("does not start the production monitor in development, whatever the config says", async () => {
    vi.stubEnv("DEVTOOLS_PATH", SECRET_PATH);

    const { connector } = await makeConnector({ enabled: true }, "development");

    await connector.boot();

    expect(h.createStore).not.toHaveBeenCalled();
    expect(h.mount).not.toHaveBeenCalled();

    await connector.shutdown();
  });
});
