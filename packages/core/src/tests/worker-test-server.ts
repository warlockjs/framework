/**
 * The HTTP server of the current Vitest worker.
 *
 * A worker keeps its own database (`<name>_<VITEST_POOL_ID>`), and a server in
 * Vitest's main process cannot read it, so the request helpers (`testGet`,
 * `actingAs`, ...) talk to a server that lives in the worker. It starts on the
 * first request of a test file, serves the app's routes through the real
 * plugins, and is closed with the file's runtime.
 *
 * A port published by `startHttpTestServer()` in `globalSetup` still wins:
 * that is the explicit choice of a shared server.
 */
import type { AppModuleImporter } from "../loader/app-module-importer";
import { getTestServerUrl } from "./test-helpers";
import { TEST_SERVER_PORT_ENV_KEY } from "./test-server-port-channel";
import type { TestHttpServer } from "./test-http-server";

let enabled = false;
let importModule: AppModuleImporter | undefined;
let current: Promise<TestHttpServer> | undefined;

/**
 * Called by `setupTest()`: this worker has a booted runtime, so the helpers may
 * serve their requests from it.
 *
 * @internal
 */
export function enableWorkerTestServer(importer: AppModuleImporter | undefined): void {
  enabled = true;
  importModule = importer;
}

/**
 * Whether requests go to this worker's own server: a booted runtime, and no
 * shared server published through `globalSetup`.
 *
 * @internal
 */
export function usesWorkerTestServer(): boolean {
  return enabled && !process.env[TEST_SERVER_PORT_ENV_KEY];
}

/**
 * The base URL the request helpers send to, starting this worker's server when
 * it is not running yet.
 *
 * @internal
 */
export async function resolveTestServerUrl(): Promise<string> {
  if (!usesWorkerTestServer()) return getTestServerUrl();

  current ??= startWorkerServer();

  try {
    return (await current).url;
  } catch (error) {
    current = undefined;
    throw error;
  }
}

async function startWorkerServer(): Promise<TestHttpServer> {
  const { createTestHttpServer } = await import("./test-http-server");
  const server = await createTestHttpServer({ loadAppModules: true, importModule });
  const close = server.close;
  const handle = current;

  server.close = async () => {
    if (current === handle) current = undefined;

    await close();
  };

  return server;
}

/**
 * Close this worker's server, if one is running.
 *
 * @internal
 */
export async function closeWorkerTestServer(): Promise<void> {
  const running = current;

  current = undefined;

  if (!running) return;

  await (await running.catch(() => undefined))?.close();
}
