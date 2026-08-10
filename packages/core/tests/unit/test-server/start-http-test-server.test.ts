import config from "@mongez/config";
import { env } from "@mongez/dotenv";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PortInUseError } from "../../../src/http/port-preflight";
import {
  startHttpTestServer,
  stopHttpTestServer,
} from "../../../src/tests/start-http-development-server";
import { getTestServerUrl } from "../../../src/tests/test-helpers";
import { TEST_SERVER_PORT_ENV_KEY } from "../../../src/tests/test-server-port-channel";

const host = "127.0.0.1";

const fixture = vi.hoisted(() => ({
  envDir: "",
  portAtLatePhase: undefined as unknown,
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
        if (phase === "late") {
          fixture.portAtLatePhase = appConfig.get("http.port");
        }
      }),
      shutdown: vi.fn(async () => undefined),
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

  it("fails the preflight with an actionable message, not EADDRINUSE, when the port is held", async () => {
    holder = await holdPort(envPort);

    const error = await startHttpTestServer().catch((thrown: unknown) => thrown as PortInUseError);

    expect(error).toBeInstanceOf(PortInUseError);
    expect(error.message).toContain(`Port ${envPort} is already in use`);
    expect(error.message).toContain("Stop the dev server");
    expect(error.message).not.toContain("EADDRINUSE");
    // nothing bound — the late phase never ran
    expect(fixture.portAtLatePhase).toBeUndefined();
  });

  it("preflights an explicitly passed port too", async () => {
    const explicitPort = await reserveFreePort();

    holder = await holdPort(explicitPort);

    const error = await startHttpTestServer({ port: explicitPort }).catch(
      (thrown: unknown) => thrown as PortInUseError,
    );

    expect(error).toBeInstanceOf(PortInUseError);
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

  it("treats port 0 as 'the OS picks one' — no preflight, and nothing published", async () => {
    // `0` is a number, so a `typeof` guard alone lets it through: the preflight
    // then binds an unrelated ephemeral port and passes vacuously, and the
    // published `0` sends every worker request to a port nothing listens on.
    await startHttpTestServer({ port: 0 });

    // the HTTP connector still binds — Fastify hands the choice to the OS
    expect(fixture.portAtLatePhase).toBe(0);
    // the channel must stay silent rather than advertise port 0 — publishing it
    // is what used to pin `getTestServerUrl()` to `http://host:0`
    //
    // NOTE: `getTestServerUrl()` can still resolve to `:0` through its own
    // `config.key("http.port", 2031)` fallback, since `0` is a defined value and
    // never reaches that default. Closing that needs the actually-bound port to
    // be read back from the HTTP connector and published — tracked separately.
    expect(process.env[TEST_SERVER_PORT_ENV_KEY]).toBeUndefined();
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
});
