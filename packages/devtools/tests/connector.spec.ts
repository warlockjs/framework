import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mountDevtoolsRoutes = vi.fn();

vi.mock("../src/server", () => ({ mountDevtoolsRoutes }));

// A minimal core: the real barrel takes longer to import than a test may
// run, and the connector only needs these two names to decide and mount.
// Sources that reach for other core exports fail to attach, which the
// connector reports and survives — exactly the behaviour under test.
vi.mock("@warlock.js/core", () => ({
  Application: { runtimeStrategy: "production" },
  getHttpServer: vi.fn(() => ({ fastify: true })),
}));
vi.mock("@warlock.js/cascade", () => ({}));
vi.mock("@warlock.js/cache", () => ({}));

describe("devtoolsConnector", () => {
  beforeEach(() => {
    mountDevtoolsRoutes.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("warns and mounts nothing in production", async () => {
    const core = await import("@warlock.js/core");
    (core.Application as { runtimeStrategy: string }).runtimeStrategy = "production";

    const { log } = await import("@warlock.js/logger");
    const warn = vi.spyOn(log, "warn");

    const { devtoolsConnector } = await import("../src/devtools-connector");
    const connector = devtoolsConnector();

    await connector.boot();

    expect(warn).toHaveBeenCalledWith(
      "devtools",
      "disabled",
      expect.stringContaining("only runs in development"),
    );
    expect(mountDevtoolsRoutes).not.toHaveBeenCalled();
    expect(connector.isActive()).toBe(false);

    await connector.shutdown();
  });

  it("mounts the dashboard routes in development", async () => {
    const core = await import("@warlock.js/core");
    (core.Application as { runtimeStrategy: string }).runtimeStrategy = "development";

    const { devtoolsConnector } = await import("../src/devtools-connector");
    const connector = devtoolsConnector();

    await connector.boot();

    expect(mountDevtoolsRoutes).toHaveBeenCalledOnce();
    expect(mountDevtoolsRoutes).toHaveBeenCalledWith(
      { fastify: true },
      expect.objectContaining({
        collector: expect.anything(),
        options: expect.objectContaining({ path: "/__warlock" }),
        isDevelopment: expect.any(Function),
        explain: expect.any(Function),
        listRoutes: expect.any(Function),
      }),
    );
    expect(connector.isActive()).toBe(true);

    await connector.shutdown();
    expect(connector.isActive()).toBe(false);
  });
});
