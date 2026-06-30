import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application as ApplicationClass } from "../../../src/application/application";
import type { health as healthRegistry } from "../../../src/http/health";

vi.mock("@warlock.js/logger", () => ({
  log: { error: vi.fn() },
}));

const bootContext = {
  environment: "test" as const,
  runtimeStrategy: "development" as const,
};

describe("health registry", () => {
  let Application: typeof ApplicationClass;
  let health: typeof healthRegistry;

  beforeEach(async () => {
    // Fresh modules so the boot/shutdown latches and the check map reset.
    vi.resetModules();
    vi.clearAllMocks();
    ({ Application } = await import("../../../src/application/application"));
    ({ health } = await import("../../../src/http/health"));
  });

  it("reports liveness ok while the process is up", () => {
    expect(health.liveness().status).toBe("ok");
  });

  it("reports readiness error before boot", async () => {
    const result = await health.readiness();

    expect(result.status).toBe("error");
  });

  it("reports readiness ok once booted with no checks", async () => {
    Application.markBooted(bootContext);

    const result = await health.readiness();

    expect(result.status).toBe("ok");
    expect(result.checks).toEqual({});
  });

  it("reports readiness error when any check fails, listing each", async () => {
    Application.markBooted(bootContext);
    health.addCheck("db", () => true);
    health.addCheck("cache", () => false);

    const result = await health.readiness();

    expect(result.status).toBe("error");
    expect(result.checks).toEqual({ db: true, cache: false });
  });

  it("treats a throwing check as failed", async () => {
    Application.markBooted(bootContext);
    health.addCheck("flaky", () => {
      throw new Error("down");
    });

    const result = await health.readiness();

    expect(result.status).toBe("error");
    expect(result.checks).toEqual({ flaky: false });
  });

  it("awaits async checks", async () => {
    Application.markBooted(bootContext);
    health.addCheck("slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return true;
    });

    const result = await health.readiness();

    expect(result.status).toBe("ok");
  });

  it("flips liveness and readiness to error during shutdown", async () => {
    Application.markBooted(bootContext);
    expect((await health.readiness()).status).toBe("ok");
    expect(health.liveness().status).toBe("ok");

    await Application.runShutdownHooks();

    expect((await health.readiness()).status).toBe("error");
    expect(health.liveness().status).toBe("error");
  });

  it("unregisters a check via removeCheck", async () => {
    Application.markBooted(bootContext);
    health.addCheck("db", () => false);
    expect((await health.readiness()).status).toBe("error");

    health.removeCheck("db");

    expect((await health.readiness()).status).toBe("ok");
  });

  it("reports not-ready when the routes-registered check sees zero routes", async () => {
    Application.markBooted(bootContext);
    health.addRoutesRegisteredCheck(() => 0);

    const result = await health.readiness();

    expect(result.status).toBe("error");
    expect(result.checks).toEqual({ routes: false });
  });

  it("reports ready when at least one route is registered", async () => {
    Application.markBooted(bootContext);
    health.addRoutesRegisteredCheck(() => 3);

    const result = await health.readiness();

    expect(result.status).toBe("ok");
    expect(result.checks).toEqual({ routes: true });
  });

  it("honours a custom check name for the routes signal", async () => {
    Application.markBooted(bootContext);
    health.addRoutesRegisteredCheck(() => 0, "http-routes");

    const result = await health.readiness();

    expect(result.checks).toEqual({ "http-routes": false });
  });
});
