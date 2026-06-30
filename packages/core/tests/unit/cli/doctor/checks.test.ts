import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the individual doctor CHECKS. Each check's external
 * dependency (router, connectors manager, config accessor) is mocked so the
 * pure verdict logic is exercised in isolation. Modules are imported lazily
 * inside each test so the per-test `vi.mock` factory wins.
 */

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("routesCheck", () => {
  it("warns when zero routes are registered", async () => {
    vi.doMock("../../../../src/router/router", () => ({
      router: { routeCount: () => 0 },
    }));

    const { routesCheck } = await import("../../../../src/cli/commands/doctor/checks/routes.check");
    const result = await routesCheck.run();

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("0 routes");
  });

  it("passes and reports the count when routes are registered", async () => {
    vi.doMock("../../../../src/router/router", () => ({
      router: { routeCount: () => 42 },
    }));

    const { routesCheck } = await import("../../../../src/cli/commands/doctor/checks/routes.check");
    const result = await routesCheck.run();

    expect(result.status).toBe("ok");
    expect(result.detail).toBe("42 registered");
  });
});

describe("configCheck", () => {
  it("fails listing every missing required section", async () => {
    vi.doMock("../../../../src/config/config-getter", () => ({
      config: { get: () => null },
    }));

    const { configCheck } = await import("../../../../src/cli/commands/doctor/checks/config.check");
    const result = await configCheck.run();

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("app");
    expect(result.detail).toContain("http");
  });

  it("passes when all required sections are present", async () => {
    vi.doMock("../../../../src/config/config-getter", () => ({
      config: { get: (name: string) => ({ section: name }) },
    }));

    const { configCheck } = await import("../../../../src/cli/commands/doctor/checks/config.check");
    const result = await configCheck.run();

    expect(result.status).toBe("ok");
  });
});

describe("connectorsCheck", () => {
  it("reports registered count and the active connectors", async () => {
    vi.doMock("../../../../src/connectors/connectors-manager", () => ({
      connectorsManager: {
        list: () => [
          { name: "logger", isActive: () => true },
          { name: "http", isActive: () => true },
          { name: "database", isActive: () => false },
        ],
      },
    }));

    const { connectorsCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/connectors.check"
    );
    const result = await connectorsCheck.run();

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("3 registered");
    expect(result.detail).toContain("logger");
    expect(result.detail).toContain("http");
    expect(result.detail).not.toContain("database");
  });

  it("notes when no connector is active", async () => {
    vi.doMock("../../../../src/connectors/connectors-manager", () => ({
      connectorsManager: {
        list: () => [{ name: "logger", isActive: () => false }],
      },
    }));

    const { connectorsCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/connectors.check"
    );
    const result = await connectorsCheck.run();

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("none active");
  });
});

describe("healthCheck", () => {
  it("warns when health endpoints are explicitly disabled", async () => {
    vi.doMock("../../../../src/config/config-getter", () => ({
      config: { get: () => ({ enabled: false }) },
    }));

    const { healthCheck } = await import("../../../../src/cli/commands/doctor/checks/health.check");
    const result = await healthCheck.run();

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("disabled");
  });

  it("passes with default paths when no health config is set", async () => {
    vi.doMock("../../../../src/config/config-getter", () => ({
      config: { get: () => undefined },
    }));

    const { healthCheck } = await import("../../../../src/cli/commands/doctor/checks/health.check");
    const result = await healthCheck.run();

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("/health");
    expect(result.detail).toContain("/ready");
  });

  it("passes with overridden paths when configured", async () => {
    vi.doMock("../../../../src/config/config-getter", () => ({
      config: { get: () => ({ path: "/livez", readinessPath: "/readyz" }) },
    }));

    const { healthCheck } = await import("../../../../src/cli/commands/doctor/checks/health.check");
    const result = await healthCheck.run();

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("/livez");
    expect(result.detail).toContain("/readyz");
  });
});

describe("optionalPeersCheck", () => {
  it("passes when every known optional peer resolves", async () => {
    vi.doMock("node:module", () => ({
      createRequire: () => ({ resolve: () => "/resolved" }),
    }));

    const { optionalPeersCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/optional-peers.check"
    );
    const result = await optionalPeersCheck.run();

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("optional peers installed");
  });

  it("warns and names the missing peers with the features they gate", async () => {
    vi.doMock("node:module", () => ({
      createRequire: () => ({
        resolve: (name: string) => {
          if (name === "@aws-sdk/client-s3") {
            throw new Error("Cannot find module");
          }

          return "/resolved";
        },
      }),
    }));

    const { optionalPeersCheck } = await import(
      "../../../../src/cli/commands/doctor/checks/optional-peers.check"
    );
    const result = await optionalPeersCheck.run();

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("@aws-sdk/client-s3");
    expect(result.detail).toContain("S3 cloud storage");
  });
});
