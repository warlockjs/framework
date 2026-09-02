import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/router/router";

/**
 * `scanDevServer` registers wildcard routes and dispatches per request, so a
 * route's own `serverOptions` have no registration slot to live in. Production
 * `scan()` forwards them; dev must not silently differ, because a control that
 * works in production and is absent in dev is believed by everyone who reviews
 * it.
 *
 * These assert the pre-handler phases only. `bodyLimit` is deliberately NOT
 * asserted: Fastify reads it at registration time and no hook can bound a body
 * already being parsed. That hole is documented on `serverOptions`, not tested
 * into existence.
 */
let close: (() => Promise<void>) | undefined;
let harnessCounter = 0;
let bootedSourceFile = "";

afterEach(async () => {
  await close?.();
  close = undefined;
});

async function bootDevServer(register: (router: Router) => void) {
  const router = Router.getInstance();
  const sourceFile = `dev-server-route-options-${harnessCounter++}`;

  bootedSourceFile = sourceFile;

  await router.withSourceFile(sourceFile, () => {
    register(router);
  });

  const server = Fastify();

  router.scanDevServer(server);

  await server.ready();

  close = async () => {
    router.removeRoutesBySourceFile(sourceFile);

    await server.close();
  };

  return server;
}

describe("dev server — per-route serverOptions", () => {
  it("matches a route with one trailing slash through the shared normalizer", async () => {
    const server = await bootDevServer((router) => {
      router.get("/about", ({ response }) => response.success({ ok: true }));
    });

    const response = await server.inject({ method: "GET", url: "/about/" });

    expect(response.statusCode).toBe(200);
  });

  it("runs a route's onRequest hook before the handler", async () => {
    const phases: string[] = [];

    const server = await bootDevServer((router) => {
      router.get(
        "/guarded",
        ({ response }) => {
          phases.push("handler");

          return response.success({ ok: true });
        },
        {
          serverOptions: {
            onRequest: async () => {
              phases.push("onRequest");
            },
          },
        },
      );
    });

    const result = await server.inject({ method: "GET", url: "/guarded" });

    expect(result.statusCode).toBe(200);
    expect(phases).toEqual(["onRequest", "handler"]);
  });

  it("lets a route's onRequest hook reject before the handler runs", async () => {
    let handlerRan = false;

    const server = await bootDevServer((router) => {
      router.post(
        "/upload",
        ({ response }) => {
          handlerRan = true;

          return response.success({ ok: true });
        },
        {
          serverOptions: {
            onRequest: async (_request: any, reply: any) => {
              return reply.code(403).send({ error: "forbidden" });
            },
          },
        },
      );
    });

    const result = await server.inject({ method: "POST", url: "/upload", payload: {} });

    expect(result.statusCode).toBe(403);
    expect(handlerRan).toBe(false);
  });

  it("accepts an array of hooks, as Fastify route options do", async () => {
    const order: string[] = [];

    const server = await bootDevServer((router) => {
      router.get("/multi", ({ response }) => response.success({ ok: true }), {
        serverOptions: {
          onRequest: [
            async () => {
              order.push("first");
            },
            async () => {
              order.push("second");
            },
          ],
        },
      });
    });

    await server.inject({ method: "GET", url: "/multi" });

    expect(order).toEqual(["first", "second"]);
  });

  it("runs preHandler hooks too", async () => {
    const phases: string[] = [];

    const server = await bootDevServer((router) => {
      router.get(
        "/pre",
        ({ response }) => {
          phases.push("handler");

          return response.success({ ok: true });
        },
        {
          serverOptions: {
            preHandler: async () => {
              phases.push("preHandler");
            },
          },
        },
      );
    });

    await server.inject({ method: "GET", url: "/pre" });

    expect(phases).toEqual(["preHandler", "handler"]);
  });

  it("does not run one route's hooks for a different route", async () => {
    let guardedHookRan = false;

    const server = await bootDevServer((router) => {
      router.get("/guarded", ({ response }) => response.success({ ok: true }), {
        serverOptions: {
          onRequest: async () => {
            guardedHookRan = true;
          },
        },
      });

      router.get("/open", ({ response }) => response.success({ ok: true }));
    });

    await server.inject({ method: "GET", url: "/open" });

    expect(guardedHookRan).toBe(false);
  });

  it("picks up a route swapped after scanning, without changing the route count", async () => {
    const router = Router.getInstance();
    const replacementSource = `dev-server-route-options-hmr-${harnessCounter++}`;

    const server = await bootDevServer((initialRouter) => {
      initialRouter.get("/old", ({ response }) => response.success({ where: "old" }));
    });

    expect((await server.inject({ method: "GET", url: "/old" })).statusCode).toBe(200);

    // What an HMR reload does: drop the file's routes, register the new ones.
    // The count is identical afterwards, so a cache keyed on length would keep
    // serving `/old` and 404 `/new`.
    const originalClose = close;

    router.removeRoutesBySourceFile(bootedSourceFile);

    await router.withSourceFile(replacementSource, () => {
      router.get("/new", ({ response }) => response.success({ where: "new" }));
    });

    close = async () => {
      router.removeRoutesBySourceFile(replacementSource);

      await originalClose?.();
    };

    expect((await server.inject({ method: "GET", url: "/new" })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: "/old" })).statusCode).toBe(404);
  });

  it("still answers 404 for an unmatched path", async () => {
    const server = await bootDevServer((router) => {
      router.get("/known", ({ response }) => response.success({ ok: true }));
    });

    const result = await server.inject({ method: "GET", url: "/unknown" });

    expect(result.statusCode).toBe(404);
  });
});
