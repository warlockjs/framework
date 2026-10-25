/**
 * An HTTP server inside the test process, built the way production builds it.
 *
 * `startHttpTestServer()` runs one server for the whole run, in Vitest's main
 * process. This is the other shape: a server per test file (or per test) in the
 * worker itself, on an OS-assigned port. Two things follow from living in the
 * worker:
 *
 * - Requests run through the REAL stack: the Fastify instance `startHttpServer`
 *   creates, every plugin `registerHttpPlugins` registers in production (rate
 *   limit, CORS, multipart, cookies, ...), and the router's real route
 *   registration. A test cannot pass against a request shape production never
 *   produces, and the plugins' own behaviour (what the rate-limit store is
 *   handed, how a cookie is parsed) is what runs.
 * - The test fakes see everything the request did: mail sent and jobs pushed
 *   by the controller land in this process's `mailFake` / `queueFake`.
 */
import { router } from "../router/router";
import type { Router } from "../router/router";
import type { AppModuleImporter } from "../loader/app-module-importer";
import { setAppModuleImporter } from "../loader/app-module-importer";
import { validateCspConfigAtBoot } from "../http/csp";
import { registerHttpPlugins } from "../http/plugins";
import { type FastifyInstance, startHttpServer } from "../http/server";
import {
  type AuthenticatedTestClient,
  type TestAuthenticableUser,
  actingAs,
} from "./authenticated-test-client";
import { forgetOpenTestServer, trackOpenTestServer } from "./open-test-servers";
import { timeTestStep } from "./test-runtime-scope";
import { type TestRequestClient, createTestRequestClient } from "./test-helpers";

export type CreateTestHttpServerOptions = {
  /**
   * Register routes for this server, exactly as a `routes.ts` would. They are
   * tagged with a source of their own and removed again by `close()`.
   */
  routes?: (router: Router) => unknown;
  /**
   * Load the application's modules (`routes.ts`, `main.ts`, events, ...) first,
   * so the server answers every app route. Needs `setupTest()` to have run in
   * this worker. Modules load once per process; later servers reuse them.
   */
  loadAppModules?: boolean;
  /**
   * How app modules are imported when `loadAppModules` is set. Pass
   * `(file) => import(file)` from the test file, as `setupTest()` takes it, so
   * app classes are the same ones the test imports.
   */
  importModule?: AppModuleImporter;
  /** Interface to bind. Defaults to `127.0.0.1`. */
  host?: string;
};

export type TestHttpServer = TestRequestClient & {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  /** The port the OS assigned. */
  readonly port: number;
  /** The Fastify instance, for `inject()` or anything else Fastify offers. */
  readonly server: FastifyInstance;
  /** A client for this server, signed in as `user` with a real access token. */
  actingAs(user: TestAuthenticableUser): Promise<AuthenticatedTestClient>;
  /** Stop listening and remove the routes `routes` registered. */
  close(): Promise<void>;
};

const APP_MODULES_LOADED_KEY = Symbol.for("warlock.core.testAppModulesLoaded");

type LoadedHolder = { [APP_MODULES_LOADED_KEY]?: Promise<void> };

let serverCounter = 0;

async function loadAppModulesOnce(importModule: AppModuleImporter | undefined): Promise<void> {
  const holder = globalThis as LoadedHolder;

  holder[APP_MODULES_LOADED_KEY] ??= (async () => {
    const { filesOrchestrator } = await import("../dev-server/files-orchestrator");

    setAppModuleImporter(importModule);

    try {
      await filesOrchestrator.init();
      await filesOrchestrator.initializeAll();
      await timeTestStep("appModules", () => filesOrchestrator.moduleLoader.loadAll());
      // The application's own routes are now part of the state a worker-scoped
      // runtime returns to between files.
      router.captureBootSnapshot();
    } finally {
      setAppModuleImporter(undefined);
    }
  })().catch((error: unknown) => {
    // A failed load may be retried by the next server.
    holder[APP_MODULES_LOADED_KEY] = undefined;
    throw error;
  });

  await holder[APP_MODULES_LOADED_KEY];
}

function boundPort(server: FastifyInstance): number {
  const address = server.server.address();

  if (address === null || typeof address === "string") {
    throw new Error("createTestHttpServer(): the server did not report a TCP port after listen().");
  }

  return address.port;
}

/**
 * Start an in-process HTTP server with the production plugins, on a free port.
 *
 * @example
 * const app = await createTestHttpServer({
 *   routes: (router) => router.post("/echo", ({ request, response }) =>
 *     response.success({ body: request.all() })),
 * });
 *
 * const response = await app.post("/echo", { name: "Ada" });
 * expect(response.status).toBe(200);
 *
 * await app.close();
 *
 * @example
 * // every app route, with the fakes seeing what the controller did
 * const app = await createTestHttpServer({
 *   loadAppModules: true,
 *   importModule: (file) => import(file),
 * });
 *
 * await app.post("/contact", { email: "ada@example.test", message: "Hi" });
 * mailFake.assertSent({ to: "support@example.test" });
 */
export async function createTestHttpServer(
  options: CreateTestHttpServerOptions = {},
): Promise<TestHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const sourceFile = `test-http-server-${++serverCounter}`;

  if (options.loadAppModules) {
    await loadAppModulesOnce(options.importModule);
  }

  if (options.routes) {
    const register = options.routes;

    await router.withSourceFile(sourceFile, () => register(router));
  }

  validateCspConfigAtBoot();

  const server = startHttpServer();

  try {
    await registerHttpPlugins(server);
    router.scan(server);
    await server.listen({ port: 0, host });
  } catch (error) {
    router.removeRoutesBySourceFile(sourceFile);
    await server.close().catch(() => undefined);
    throw error;
  }

  const port = boundPort(server);
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
  const client = createTestRequestClient(url);
  let closed = false;

  const handle: TestHttpServer = {
    ...client,
    url,
    port,
    server,
    actingAs: (user) => actingAs(user, client),
    close: async () => {
      if (closed) return;

      closed = true;
      forgetOpenTestServer(handle);
      router.removeRoutesBySourceFile(sourceFile);
      await server.close();
    },
  };

  trackOpenTestServer(handle);

  return handle;
}
