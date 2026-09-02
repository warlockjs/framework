import config from "@mongez/config";
import { env } from "@mongez/dotenv";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PortInUseError } from "../../../src/http/port-preflight";
import {
  isTestServerRunning,
  startHttpTestServer,
  stopHttpTestServer,
} from "../../../src/tests/start-http-development-server";
import { getTestServerUrl } from "../../../src/tests/test-helpers";
import { TEST_SERVER_PORT_ENV_KEY } from "../../../src/tests/test-server-port-channel";

const host = "127.0.0.1";

const fixture = vi.hoisted(() => ({
  envDir: "",
  portAtLatePhase: undefined as unknown,
  /** Fails the late connector phase, i.e. after the port has been published. */
  failLatePhase: false,
  /** Fails teardown, including the best-effort unwind of a failed startup. */
  failShutdown: false,
}));

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { load: vi.fn(async () => undefined) },
}));

vi.mock("../../../src/dev-server/files-orchestrator", () => ({
  filesOrchestrator: {
    init: vi.fn(async () => undefined),
    initializeAll: vi.fn(async () => undefined),
    moduleLoader: { loadAll: vi.fn(async () => undefined) },
  },
}));

// The real `bootstrap()` calls `loadEnv()` with dotenv's default `override: true`
// against `cwd()`. Pointing the very same loader at the fixture directory is the
// only difference — the re-read (and therefore the clobbering) is genuine.
vi.mock("../../../src/bootstrap", async () => {
  const { loadEnv } = await import("@mongez/dotenv");

  return {
    bootstrap: vi.fn(async () => {
      loadEnv(undefined, { dir: fixture.envDir });
    }),
  };
});

// Stands in for the app's own `src/config/http.ts`, which resolves its bind port
// through `env()` — the reason a caller-side override never survives.
vi.mock("../../../src/config/load-config-files", async () => {
  const { default: appConfig } = await import("@mongez/config");
  const { env: readEnv } = await import("@mongez/dotenv");

  return {
    loadConfigFiles: vi.fn(async () => {
      appConfig.set("http", { port: readEnv("HTTP_PORT", 2031), host: "127.0.0.1" });
    }),
  };
});

vi.mock("../../../src/connectors/connectors-manager", async () => {
  const { default: appConfig } = await import("@mongez/config");

  return {
    connectorsManager: {
      startPhase: vi.fn(async (phase: string) => {
        if (phase !== "late") return;

        if (fixture.failLatePhase) {
          throw new Error("late phase exploded");
        }

        fixture.portAtLatePhase = appConfig.get("http.port");
      }),
      shutdown: vi.fn(async () => {
        if (fixture.failShutdown) {
          throw new Error("shutdown exploded");
        }
      }),
    },
  };
});

/**
 * Bind port 0, read the port the OS handed out, release it. The port is then
 * free and almost certainly still free a moment later.
 */
function reserveFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();

    probe.listen({ port: 0, host }, () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;

      probe.close(() => resolve(port));
    });
  });
}

function holdPort(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer();

    server.listen({ port, host }, () => resolve(server));
  });
}

function releasePort(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe("startHttpTestServer", () => {
  let envPort = 0;
  let holder: Server | undefined;

  beforeAll(async () => {
    fixture.envDir = mkdtempSync(join(tmpdir(), "warlock-test-server-"));
    envPort = await reserveFreePort();

    writeFileSync(join(fixture.envDir, ".env"), `HTTP_PORT=${envPort}\n`, "utf-8");
  });

  afterEach(async () => {
    // Cleared before the teardown call so a spec that made shutdown fail cannot
    // fail the suite's own cleanup too.
    fixture.failLatePhase = false;
    fixture.failShutdown = false;

    await stopHttpTestServer();

    if (holder) {
      await releasePort(holder);
      holder = undefined;
    }

    fixture.portAtLatePhase = undefined;
    delete process.env.HTTP_PORT;
    delete process.env[TEST_SERVER_PORT_ENV_KEY];
  });

  afterAll(() => {
    rmSync(fixture.envDir, { recursive: true, force: true });
  });

  it("honours an explicit port even though .env names a different HTTP_PORT", async () => {
    holder = await holdPort(envPort);

    const explicitPort = await reserveFreePort();

    await startHttpTestServer({ port: explicitPort });

    expect(config.get("http.port")).toBe(explicitPort);
    // the port the HTTP connector would have bound
    expect(fixture.portAtLatePhase).toBe(explicitPort);
    // .env was re-read by the internal bootstrap and still says otherwise
    expect(env("HTTP_PORT")).toBe(envPort);
    expect(explicitPort).not.toBe(envPort);
  });

  it("fails the preflight with an actionable message that also names EADDRINUSE, when the port is held", async () => {
    holder = await holdPort(envPort);

    const error = await startHttpTestServer().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PortInUseError);
    // `expect()` is not a type guard and `.catch()` widens the binding to
    // include the resolved value, so narrow before reading `.message`.
    assert(error instanceof PortInUseError);
    expect(error.message).toContain(`Port ${envPort} is already in use`);
    expect(error.message).toContain("Stop the dev server");
    // Named up front, not hidden behind the actionable instruction — see
    // `PortInUseError` in `port-preflight.ts`.
    expect(error.message).toContain("EADDRINUSE");
    // nothing bound — the late phase never ran
    expect(fixture.portAtLatePhase).toBeUndefined();
  });

  it("preflights an explicitly passed port too", async () => {
    const explicitPort = await reserveFreePort();

    holder = await holdPort(explicitPort);

    const error = await startHttpTestServer({ port: explicitPort }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(PortInUseError);
    assert(error instanceof PortInUseError);
    expect(error.message).toContain(`Port ${explicitPort} is already in use`);
  });

  it("ignores a caller-side process.env override — env() never reads process.env", async () => {
    const ignoredPort = await reserveFreePort();

    process.env.HTTP_PORT = String(ignoredPort);

    await startHttpTestServer();

    expect(config.get("http.port")).toBe(envPort);
    expect(config.get("http.port")).not.toBe(ignoredPort);
  });

  it("publishes the bound port so worker-side request helpers target it", async () => {
    holder = await holdPort(envPort);

    const explicitPort = await reserveFreePort();

    await startHttpTestServer({ port: explicitPort });

    expect(process.env[TEST_SERVER_PORT_ENV_KEY]).toBe(String(explicitPort));
    expect(getTestServerUrl()).toContain(`:${explicitPort}`);

    await stopHttpTestServer();

    expect(process.env[TEST_SERVER_PORT_ENV_KEY]).toBeUndefined();
  });

  it("rejects port 0 with an actionable message instead of half-supporting it", async () => {
    // Port `0` used to be accepted and deliberately not published, on the
    // grounds that the OS picks the port. That left the trap this test now
    // closes: `getTestServerUrl()` resolves `0` through its own
    // `config.key("http.port", 2031)` fallback — `0` is a defined value and
    // never reaches that default — so every worker request went to
    // `http://host:0`, where nothing listens. Publishing the real port instead
    // is not available: `HttpConnector.start()` records the port it ASKED for,
    // not the one Fastify bound.
    // Cast the awaited result, not the caught value: the call resolves to
    // `void` on success, so `.catch(x => x as Error)` types as `void | Error`
    // and `.message` never narrows.
    const error = (await startHttpTestServer({ port: 0 }).catch(
      (thrown: unknown) => thrown,
    )) as Error;

    expect(error).toBeInstanceOf(Error);
    // says what to do, not only what failed — the standard `PortInUseError` sets
    expect(error.message).toContain("cannot run on port 0");
    expect(error.message).toContain("startHttpTestServer({ port: 3999 })");

    // rejected before anything bound
    expect(fixture.portAtLatePhase).toBeUndefined();
    expect(process.env[TEST_SERVER_PORT_ENV_KEY]).toBeUndefined();
  });

  /**
   * Canon `1dbe51b1` — `startHttpTestServer` owns the connectors it starts; a
   * partial failure unwinds, always withdraws the port and resets state, and
   * rethrows the ORIGINAL error. `stopHttpTestServer` withdraws and resets in a
   * `finally` while still surfacing the failure.
   */
  describe("failure atomicity", () => {
    it("withdraws the published port when the late phase fails after publishing it", async () => {
      const explicitPort = await reserveFreePort();

      fixture.failLatePhase = true;

      const error = (await startHttpTestServer({ port: explicitPort }).catch(
        (thrown: unknown) => thrown,
      )) as Error;

      // Asserted before `.message` is read: the cast above is unconditional, so
      // without this a startup that stopped throwing would fail as a confusing
      // "cannot read properties of undefined" instead of "it did not reject".
      expect(error).toBeInstanceOf(Error);
      // the original startup failure, not a cleanup error standing in for it
      expect(error.message).toBe("late phase exploded");
      // the port was published BEFORE the phase that failed — it must not
      // outlive the server it points at
      expect(process.env[TEST_SERVER_PORT_ENV_KEY]).toBeUndefined();
      // `isServerRunning` is set on the last line, so before this fix a failed
      // start left teardown reporting "No server to stop" over live connectors
      expect(isTestServerRunning()).toBe(false);
    });

    it("tears down the connectors it already started when startup fails", async () => {
      const explicitPort = await reserveFreePort();
      const { connectorsManager } = await import("../../../src/connectors/connectors-manager");

      vi.mocked(connectorsManager.shutdown).mockClear();

      fixture.failLatePhase = true;

      await startHttpTestServer({ port: explicitPort }).catch(() => undefined);

      expect(connectorsManager.shutdown).toHaveBeenCalled();
    });

    it("rethrows the startup error even when the cleanup shutdown also fails", async () => {
      const explicitPort = await reserveFreePort();

      fixture.failLatePhase = true;
      fixture.failShutdown = true;

      const error = (await startHttpTestServer({ port: explicitPort }).catch(
        (thrown: unknown) => thrown,
      )) as Error;

      expect(error).toBeInstanceOf(Error);
      // a cleanup failure is secondary: it must not replace the cause
      expect(error.message).toBe("late phase exploded");
      expect(error.message).not.toBe("shutdown exploded");
      // and cleanup still completed everything it could
      expect(process.env[TEST_SERVER_PORT_ENV_KEY]).toBeUndefined();
      expect(isTestServerRunning()).toBe(false);
    });

    it("withdraws the port and resets state when stopHttpTestServer's shutdown throws", async () => {
      const explicitPort = await reserveFreePort();

      await startHttpTestServer({ port: explicitPort });

      expect(process.env[TEST_SERVER_PORT_ENV_KEY]).toBe(String(explicitPort));

      fixture.failShutdown = true;

      const error = (await stopHttpTestServer().catch(
        (thrown: unknown) => thrown,
      )) as Error;

      expect(error).toBeInstanceOf(Error);
      // the failure is surfaced — cleaning up is not the same as succeeding
      expect(error.message).toBe("shutdown exploded");
      // …and the cleanup still ran, so the next run in this process cannot
      // inherit a port pointing at a server that is gone
      expect(process.env[TEST_SERVER_PORT_ENV_KEY]).toBeUndefined();
      expect(isTestServerRunning()).toBe(false);
    });
  });

  it("keeps stopHttpTestServer working, and a stopped server can start again", async () => {
    const firstPort = await reserveFreePort();

    await startHttpTestServer({ port: firstPort });

    const { connectorsManager } = await import("../../../src/connectors/connectors-manager");

    await stopHttpTestServer();

    expect(connectorsManager.shutdown).toHaveBeenCalled();

    const secondPort = await reserveFreePort();

    await startHttpTestServer({ port: secondPort });

    expect(fixture.portAtLatePhase).toBe(secondPort);
  });

  describe("boot parity", () => {
    it("fails loudly with the raw value when HTTP_PORT does not round-trip through Number()", async () => {
      // Mirrors what `env()` hands back for e.g. `HTTP_PORT=03999`: a string,
      // because it does not round-trip through `Number()` exactly.
      const badEnvDir = mkdtempSync(join(tmpdir(), "warlock-test-server-bad-port-"));
      writeFileSync(join(badEnvDir, ".env"), "HTTP_PORT=03999\n", "utf-8");

      const originalEnvDir = fixture.envDir;
      fixture.envDir = badEnvDir;

      const { connectorsManager } = await import("../../../src/connectors/connectors-manager");

      vi.mocked(connectorsManager.startPhase).mockClear();

      try {
        const error = await startHttpTestServer().catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('"03999"');
        expect(connectorsManager.startPhase).not.toHaveBeenCalledWith("late");
      } finally {
        fixture.envDir = originalEnvDir;
        rmSync(badEnvDir, { recursive: true, force: true });
      }
    });

    it("calls runStartupValidators after modules load and before the late connector phase", async () => {
      const { filesOrchestrator } = await import("../../../src/dev-server/files-orchestrator");
      const { connectorsManager } = await import("../../../src/connectors/connectors-manager");
      const { Application } = await import("../../../src/application");

      vi.mocked(filesOrchestrator.moduleLoader.loadAll).mockClear();
      vi.mocked(connectorsManager.startPhase).mockClear();

      const validatorsSpy = vi
        .spyOn(Application, "runStartupValidators")
        .mockResolvedValue(undefined);

      try {
        const port = await reserveFreePort();

        await startHttpTestServer({ port });

        expect(filesOrchestrator.moduleLoader.loadAll).toHaveBeenCalledOnce();
        expect(validatorsSpy).toHaveBeenCalledOnce();

        const lateCallIndex = vi
          .mocked(connectorsManager.startPhase)
          .mock.calls.findIndex(([phase]) => phase === "late");

        expect(lateCallIndex).toBeGreaterThanOrEqual(0);

        const loadAllOrder = vi.mocked(filesOrchestrator.moduleLoader.loadAll).mock
          .invocationCallOrder[0];
        const validatorsOrder = validatorsSpy.mock.invocationCallOrder[0];
        const lateOrder = vi.mocked(connectorsManager.startPhase).mock.invocationCallOrder[
          lateCallIndex
        ];

        expect(loadAllOrder).toBeLessThan(validatorsOrder);
        expect(validatorsOrder).toBeLessThan(lateOrder);
      } finally {
        validatorsSpy.mockRestore();
      }
    });

    it("a rejecting validator stops the late connector phase from ever starting", async () => {
      const { connectorsManager } = await import("../../../src/connectors/connectors-manager");
      const { Application } = await import("../../../src/application");

      vi.mocked(connectorsManager.startPhase).mockClear();

      const validatorsSpy = vi
        .spyOn(Application, "runStartupValidators")
        .mockRejectedValueOnce(
          new Error('Startup validator "requireJwtSecret" rejected boot: JWT_SECRET is not set'),
        );

      try {
        const port = await reserveFreePort();

        await expect(startHttpTestServer({ port })).rejects.toThrow(/JWT_SECRET is not set/);

        expect(connectorsManager.startPhase).not.toHaveBeenCalledWith("late");
      } finally {
        validatorsSpy.mockRestore();
      }
    });
  });
});
