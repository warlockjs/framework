import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../application";
import { resetRolesCacheForTests } from "../application/roles";
import { health } from "../http/health";
import { router } from "../router/router";

vi.mock("@warlock.js/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warlock.js/logger")>();

  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn(), fatal: vi.fn() },
  };
});

vi.mock("../http/port-preflight", () => ({
  assertPortIsAvailable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../http/plugins", () => ({
  registerHttpPlugins: vi.fn().mockResolvedValue(undefined),
}));

const listen = vi.fn().mockResolvedValue("http://127.0.0.1:3000");
const fastifyGet = vi.fn();
const fastifyRegister = vi.fn();

vi.mock("../http/server", () => ({
  startHttpServer: vi.fn(() => ({
    get: fastifyGet,
    register: fastifyRegister,
    listen,
  })),
  getHttpServer: vi.fn(),
  closeServerWithTimeout: vi.fn(),
}));

const httpConfig = { port: 3000, host: "localhost" };

describe("HttpConnector — role-gated start()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listen.mockResolvedValue("http://127.0.0.1:3000");
    Application.setRuntimeStrategy("production");
    resetRolesCacheForTests();
    vi.spyOn(config, "get").mockImplementation(((key: string, fallback?: unknown) => {
      if (key === "http") return httpConfig;
      return fallback;
    }) as never);
    vi.spyOn(health, "addRoutesRegisteredCheck").mockImplementation(() => {});
    vi.spyOn(router, "scan").mockImplementation(() => {});
    vi.spyOn(router, "scanDevServer").mockImplementation(() => {});
    vi.spyOn(router, "routeCount").mockReturnValue(0);
  });

  afterEach(() => {
    delete process.env.WARLOCK_ROLES;
    resetRolesCacheForTests();
    vi.restoreAllMocks();
  });

  it("does not bind the port when only the worker role is active", async () => {
    process.env.WARLOCK_ROLES = "worker";

    const { HttpConnector } = await import("./http-connector");
    const connector = new HttpConnector();

    await connector.boot();
    await connector.start();

    expect(listen).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      "http",
      "connection",
      expect.stringContaining("http: not started (role: worker)"),
    );
  });

  it("binds the port when the api role is active", async () => {
    process.env.WARLOCK_ROLES = "api";

    const { HttpConnector } = await import("./http-connector");
    const connector = new HttpConnector();

    await connector.boot();
    await connector.start();

    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("binds the port when the web role is active", async () => {
    process.env.WARLOCK_ROLES = "web";

    const { HttpConnector } = await import("./http-connector");
    const connector = new HttpConnector();

    await connector.boot();
    await connector.start();

    expect(listen).toHaveBeenCalledTimes(1);
  });
});
