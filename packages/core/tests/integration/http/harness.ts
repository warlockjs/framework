import Fastify from "fastify";
import { Router } from "../../../src/router/router";
import type { FastifyInstance } from "../../../src/http/server";

/**
 * In-process HTTP harness for exercising the real Fastify → router → request →
 * middleware → controller → response path without binding a port.
 *
 * **Role.** A throwaway test fixture that boots a bare Fastify instance, lets a
 * test register routes through the production `Router` singleton, scans them
 * onto the instance, and drives requests via Fastify's `inject()`. Every route
 * registered through the harness is stamped with a unique `sourceFile` so the
 * process-wide router singleton stays isolated between tests — teardown removes
 * exactly the routes this harness added.
 *
 * **Responsibility.**
 * - Owns: per-test source-file scoping, booting + readying the Fastify
 *   instance, scanning routes, injecting requests, and full teardown (route
 *   removal + server close).
 * - Does NOT own: how the router builds routes, how the request lifecycle runs,
 *   or any assertion logic — those live in the framework and the test bodies.
 *
 * @example
 * const harness = await bootHarness((router) => {
 *   router.get("/ping", (request, response) => response.success({ ok: true }));
 * });
 *
 * const result = await harness.inject({ method: "GET", url: "/ping" });
 * expect(result.statusCode).toBe(200);
 *
 * await harness.close();
 */
export interface HttpHarness {
  /**
   * The booted Fastify instance, exposed for advanced injection scenarios.
   */
  readonly server: FastifyInstance;
  /**
   * The source-file tag every route registered through this harness carries.
   */
  readonly sourceFile: string;
  /**
   * Inject a request through the real route path and resolve the reply.
   */
  inject: FastifyInstance["inject"];
  /**
   * Parse the JSON body of a previously-captured inject result.
   */
  json: (result: { body: string }) => any;
  /**
   * Remove every route this harness registered, then close the server.
   */
  close: () => Promise<void>;
}

let harnessCounter = 0;

/**
 * Boot a harness: register routes inside an isolated source-file scope, scan
 * them onto a fresh Fastify instance, and wait until the instance is ready.
 *
 * The `register` callback receives the live router singleton; add routes on it
 * exactly as application code would. Routes added here are auto-tagged with the
 * harness `sourceFile` so `close()` can remove only them.
 */
export async function bootHarness(
  register: (router: Router) => void,
): Promise<HttpHarness> {
  const router = Router.getInstance();
  const sourceFile = `integration-http-${harnessCounter++}`;

  await router.withSourceFile(sourceFile, () => {
    register(router);
  });

  const server = Fastify();

  router.scan(server);

  await server.ready();

  return {
    server,
    sourceFile,
    inject: server.inject.bind(server),
    json: (result) => JSON.parse(result.body),
    close: async () => {
      router.removeRoutesBySourceFile(sourceFile);

      await server.close();
    },
  };
}
