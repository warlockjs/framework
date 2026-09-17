import type { Middleware } from "@warlock.js/core";
import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { runDashboardMiddleware } from "./dashboard-middleware-adapter";

/**
 * Wrap bull-board's Fastify plugin in a scope that runs `middlewareList`
 * on every request before bull-board's own routes see it.
 *
 * Bull-board's `FastifyAdapter.registerPlugin()` returns a plain Fastify
 * plugin with no hook for Warlock middleware to run through, and Fastify
 * only lets an `onRequest` hook be added to a plugin scope — never spliced
 * into a plugin someone else wrote. So this builds ONE plugin that adds the
 * hook to its own scope and then registers bull-board's plugin as a child of
 * that scope; Fastify's encapsulation runs the hook for every route the
 * child registers, which is every dashboard route.
 */
export function buildDashboardGuardPlugin(
  middlewareList: Middleware[],
  bullBoardPlugin: unknown,
): FastifyPluginCallback {
  return function dashboardGuardPlugin(instance: FastifyInstance, _options, done) {
    if (middlewareList.length > 0) {
      instance.addHook("onRequest", async (request, reply) => {
        await runDashboardMiddleware(middlewareList, request, reply);
      });
    }

    instance.register(bullBoardPlugin as never);
    done();
  };
}
