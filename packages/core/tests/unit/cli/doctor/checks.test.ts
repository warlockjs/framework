import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the individual doctor CHECKS. Each check's external
 * dependency (router, connectors manager, config accessor) is mocked so the
 * pure verdict logic is exercised in isolation. Modules are imported lazily
 * inside each test so the per-test `vi.mock` factory wins.
 */

import type { DoctorBootContext } from "../../../../src/cli/commands/doctor/check.types";

/**
 * A healthy boot context. Each test overrides only the field it is about, so a
 * later change to the context shape lands in one place instead of thirteen.
 *
 * Checks read EVERYTHING they need about the app off this object — they do not
 * reach for the router or the connectors manager themselves. That is why the
 * module mocks these tests used to carry are gone: they mocked collaborators
 * the checks no longer have.
 */
function makeContext(overrides: Partial<DoctorBootContext> = {}): DoctorBootContext {
  return {
    booted: true,
    routeModules: 3,
    appRoutes: 42,
    totalRoutes: 42,
    moduleFailures: [],
    connectors: {
      registered: ["logger", "http", "database"],
      configured: [],
      booted: ["logger", "http", "database"],
      skipped: [],
      failures: [],
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("routesCheck", () => {
  /**
   * Zero routes from zero route modules is OK, not a warning. A worker or
   * CLI-only app is a legitimate shape and doctor must not nag it — see the
   * verdict list at the top of routes.check.ts. The previous version of this
   * test asserted `warn` + "0 routes", which is the behaviour that was
   * deliberately removed.
   */
  it("passes quietly when the app declares no route modules at all", async () => {
    const { routesCheck } = await import("../../../../src/cli/commands/doctor/checks/routes.check");
    const result = await routesCheck.run(makeContext({ routeModules: 0, appRoutes: 0, totalRoutes: 0 }));

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("no route modules found");
  });

  /** Route modules that load cleanly and register nothing IS a failure: every request 404s. */
  it("fails when route modules loaded but registered nothing", async () => {
    const { routesCheck } = await import("../../../../src/cli/commands/doctor/checks/routes.check");
    const result = await routesCheck.run(makeContext({ routeModules: 3, appRoutes: 0, totalRoutes: 0 }));

    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("registered 0 routes");
  });

  it("fails and names the modules that could not be imported", async () => {
    const { routesCheck } = await import("../../../../src/cli/commands/doctor/checks/routes.check");
    const result = await routesCheck.run(
      makeContext({ moduleFailures: [{ file: "src/app/users/routes.ts", message: "boom" }] }),
    );

    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("src/app/users/routes.ts");
  });

  it("passes and splits the count between app modules and connectors", async () => {
    const { routesCheck } = await import("../../../../src/cli/commands/doctor/checks/routes.check");
    const result = await routesCheck.run(makeContext({ routeModules: 3, appRoutes: 40, totalRoutes: 42 }));

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("42 registered");
    expect(result?.detail).toContain("40 from 3 route module(s)");
    expect(result?.detail).toContain("2 from connectors");
  });
});

describe("configCheck", () => {
  it("fails listing every missing required section", async () => {
    vi.doMock("../../../../src/config/config-getter", () => ({
      config: { get: () => null },
    }));

    const { configCheck } = await import("../../../../src/cli/commands/doctor/checks/config.check");
    const result = await configCheck.run(makeContext());

    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("app");
    expect(result?.detail).toContain("http");
  });

  it("passes when all required sections are present", async () => {
    vi.doMock("../../../../src/config/config-getter", () => ({
      config: { get: (name: string) => ({ section: name }) },
    }));

    const { configCheck } = await import("../../../../src/cli/commands/doctor/checks/config.check");
    const result = await configCheck.run(makeContext());

    expect(result?.status).toBe("ok");
  });
});

describe("connectorsCheck", () => {
  /**
   * The check reports what the APP configured against the built-in count, not
   * an "active" flag — the built-in count is a constant and diagnoses nothing,
   * so it is the configured list that carries information.
   */
  it("names the connectors the app configured, against the built-in count", async () => {
    const { connectorsCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/connectors.check"
    );
    const result = await connectorsCheck.run(
      makeContext({
        connectors: {
          registered: ["logger", "http", "database"],
          configured: ["database"],
          booted: ["logger", "http", "database"],
          skipped: [],
          failures: [],
        },
      }),
    );

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("database from warlock.config.ts");
    expect(result?.detail).toContain("2 built-in");
  });

  it("says so plainly when the app configured none of its own", async () => {
    const { connectorsCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/connectors.check"
    );
    const result = await connectorsCheck.run(makeContext());

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("none configured in warlock.config.ts");
  });

  /** A connector whose boot() threw is a failure, named with its message. */
  it("fails and names every connector whose boot threw", async () => {
    const { connectorsCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/connectors.check"
    );
    const result = await connectorsCheck.run(
      makeContext({
        connectors: {
          registered: ["logger", "http"],
          configured: [],
          booted: ["logger"],
          skipped: [],
          failures: [{ name: "http", message: "port in use" }],
        },
      }),
    );

    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("http: port in use");
  });

  /** A refused connectors config would crash the next real boot — that is a fail, not a note. */
  it("fails when warlock.config.ts > connectors was refused outright", async () => {
    const { connectorsCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/connectors.check"
    );
    const result = await connectorsCheck.run(
      makeContext({
        connectors: {
          registered: [],
          configured: [],
          booted: [],
          skipped: [],
          failures: [],
          registrationError: "duplicate name \"http\"",
        },
      }),
    );

    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("was refused");
  });
});

describe("healthCheck", () => {
  /**
   * The check needs `http` config to exist at all — with no http section it
   * returns undefined, because a project with no HTTP server has no probes to
   * report on. These mocks are therefore key-aware rather than blanket.
   */
  /**
   * healthCheck reads THREE globals, not one: config, the container (for the booted
   * Fastify instance) and the router (to detect an app route claiming a probe path).
   * Mocking only config left the other two live, so the verdict depended on whatever
   * else the suite had registered — these passed alone and failed in the full run.
   * All three are pinned here so the assertion is about the check, not the order.
   */
  function mockHealthEnv(health: unknown, options: { hasServer?: boolean; routes?: unknown[] } = {}) {
    vi.doMock("../../../../src/config/config-getter", () => ({
      config: {
        get: (key: string) => (key === "http.health" ? health : key === "http" ? {} : undefined),
      },
    }));

    vi.doMock("../../../../src/container", () => ({
      container: {
        has: () => options.hasServer === true,
        get: () => undefined,
      },
    }));

    vi.doMock("../../../../src/router/router", () => ({
      router: { list: () => options.routes ?? [] },
    }));
  }

  /** Disabling the probes on purpose is a stated fact, not a warning. */
  it("reports probes as disabled — without warning — when config turns them off", async () => {
    mockHealthEnv({ enabled: false });

    const { healthCheck } = await import("../../../../src/cli/commands/doctor/checks/health.check");
    const result = await healthCheck.run(makeContext());

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("disabled by config");
  });

  /**
   * With no live http server in the container the route table cannot be read,
   * so the honest verdict is `warn` + "unverified" rather than a false `ok`.
   * What these two cases still prove is that the DEFAULT and the CONFIGURED
   * paths are the ones carried through.
   */
  it("uses the default probe paths when none are configured", async () => {
    mockHealthEnv(undefined);

    const { healthCheck } = await import("../../../../src/cli/commands/doctor/checks/health.check");
    const result = await healthCheck.run(makeContext());

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("/health");
    expect(result?.detail).toContain("/ready");
  });

  it("uses the overridden probe paths when configured", async () => {
    mockHealthEnv({ path: "/livez", readinessPath: "/readyz" });

    const { healthCheck } = await import("../../../../src/cli/commands/doctor/checks/health.check");
    const result = await healthCheck.run(makeContext());

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("/livez");
    expect(result?.detail).toContain("/readyz");
  });

  /**
   * The HTTP connector registers the probes. If it never booted, the connectors
   * check already reports that with its reason — saying it again here would
   * inflate one defect into two, so this check stays silent.
   */
  it("stays silent when the http connector never booted", async () => {
    mockHealthEnv(undefined);

    const { healthCheck } = await import("../../../../src/cli/commands/doctor/checks/health.check");
    const result = await healthCheck.run(
      makeContext({
        connectors: {
          registered: ["logger", "http"],
          configured: [],
          booted: ["logger"],
          skipped: [],
          failures: [],
        },
      }),
    );

    expect(result).toBeUndefined();
  });
});

describe("optionalPeersCheck", () => {
  /**
   * The check reports only on peers the project's OWN config selects. With
   * nothing selected it returns undefined and stays silent — warning that a
   * MySQL driver is absent is not a diagnosis for someone who never wanted
   * MySQL. So every scenario here must configure a feature first.
   */
  function mockProject(driver: string | undefined, resolve: (name: string) => string) {
    vi.doMock("../../../../src/config/config-getter", () => ({
      config: { get: (key: string) => (key === "database.driver" ? driver : undefined) },
    }));

    vi.doMock("node:module", () => ({ createRequire: () => ({ resolve }) }));
  }

  it("stays silent when the project configures no optional-peer features", async () => {
    mockProject(undefined, () => "/resolved");

    const { optionalPeersCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/optional-peers.check"
    );

    expect(await optionalPeersCheck.run(makeContext())).toBeUndefined();
  });

  it("passes when the driver the project selected is installed", async () => {
    mockProject("mongodb", () => "/resolved");

    const { optionalPeersCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/optional-peers.check"
    );
    const result = await optionalPeersCheck.run(makeContext());

    expect(result?.status).toBe("ok");
  });

  it("fails naming the missing driver and the config that asked for it", async () => {
    mockProject("mongodb", (name: string) => {
      if (name === "mongodb") throw new Error("Cannot find module");

      return "/resolved";
    });

    const { optionalPeersCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/optional-peers.check"
    );
    const result = await optionalPeersCheck.run(makeContext());

    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("mongodb");
    expect(result?.detail).toContain('database.driver = "mongodb"');
  });
});

describe("handlerSignatureCheck", () => {
  it("passes when no handler looks like the v4 positional signature", async () => {
    vi.doMock("../../../../src/router/positional-handler-diagnostics", () => ({
      listPositionalHandlerSuspects: () => [],
      describePositionalHandlerSuspect: () => "",
    }));

    const { handlerSignatureCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/handler-signature.check"
    );
    const result = await handlerSignatureCheck.run(makeContext());

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("no handlers");
  });

  it("warns — never fails — listing every suspect with its fix", async () => {
    vi.doMock("../../../../src/router/positional-handler-diagnostics", () => ({
      listPositionalHandlerSuspects: () => [
        { method: "GET", path: "/", handlerName: "homePageController", sourceFile: "routes.ts" },
        { method: "POST", path: "/users", handlerName: "createUser", sourceFile: "routes.ts" },
      ],
      describePositionalHandlerSuspect: (suspect: any) =>
        `Handler "${suspect.handlerName}" (${suspect.method} ${suspect.path}) fix it`,
    }));

    const { handlerSignatureCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/handler-signature.check"
    );
    const result = await handlerSignatureCheck.run(makeContext());

    // A heuristic must not fail a build.
    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("2 handlers look like the v4 positional signature");
    expect(result?.detail).toContain('Handler "homePageController" (GET /)');
    expect(result?.detail).toContain('Handler "createUser" (POST /users)');
  });
});
