import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_SERVER_PORT_ENV_KEY } from "./test-server-port-channel";

const created: Array<{ url: string; close: ReturnType<typeof vi.fn> }> = [];

vi.mock("./test-http-server", () => ({
  createTestHttpServer: vi.fn(async (options: unknown) => {
    const server = {
      url: `http://127.0.0.1:${4000 + created.length}`,
      options,
      close: vi.fn(async () => undefined),
    };

    created.push(server);

    return server;
  }),
}));

async function load() {
  vi.resetModules();

  return import("./worker-test-server");
}

let published: string | undefined;

beforeEach(() => {
  created.length = 0;
  published = process.env[TEST_SERVER_PORT_ENV_KEY];
  delete process.env[TEST_SERVER_PORT_ENV_KEY];
});

afterEach(() => {
  if (published === undefined) delete process.env[TEST_SERVER_PORT_ENV_KEY];
  else process.env[TEST_SERVER_PORT_ENV_KEY] = published;
});

describe("worker test server", () => {
  it("is not used before setupTest() enabled it", async () => {
    const worker = await load();

    expect(worker.usesWorkerTestServer()).toBe(false);
  });

  it("starts one server in this worker and reuses it for every request", async () => {
    const worker = await load();
    const importModule = vi.fn();

    worker.enableWorkerTestServer(importModule);

    const first = await worker.resolveTestServerUrl();
    const second = await worker.resolveTestServerUrl();

    expect(first).toBe(second);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ options: { loadAppModules: true, importModule } });
  });

  it("starts a fresh server after the file's server was closed", async () => {
    const worker = await load();

    worker.enableWorkerTestServer(undefined);
    await worker.resolveTestServerUrl();
    await worker.closeWorkerTestServer();
    await worker.resolveTestServerUrl();

    expect(created).toHaveLength(2);
    expect(created[0]!.close).toHaveBeenCalledTimes(1);
  });

  it("lets a shared server published by globalSetup win", async () => {
    const worker = await load();

    worker.enableWorkerTestServer(undefined);
    process.env[TEST_SERVER_PORT_ENV_KEY] = "4999";

    expect(worker.usesWorkerTestServer()).toBe(false);
    expect(await worker.resolveTestServerUrl()).toMatch(/:4999$/);
    expect(created).toHaveLength(0);
  });
});
