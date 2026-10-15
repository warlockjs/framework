import type { Middleware } from "@warlock.js/core";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Run a Warlock middleware list against a raw Fastify request/reply pair.
 *
 * Bull-board's `FastifyAdapter` hands back a plain Fastify plugin, not a
 * Warlock route — there is no `Route`, no validation pipeline, and none of
 * `createRequestStore`'s context wiring (CSP, tracing, `@warlock.js/context`
 * stores). Reusing that full pipeline here would pull the whole request
 * machinery into a place it was never meant to run. Instead this builds the
 * minimal `Request`/`Response` pair — enough for guard-style middleware
 * (`authMiddleware`, `ipFilterMiddleware`, a custom check) to read the
 * request and short-circuit with a response, which covers every one of
 * bull-board's routes because they all sit behind the same hook.
 *
 * `@warlock.js/core` is imported dynamically so this module never drags
 * core's runtime graph into a process that never mounts the dashboard.
 *
 * @returns `true` when a middleware sent a response and the caller must not
 * continue (bull-board's handler must not run); `false` to continue.
 */
export async function runDashboardMiddleware(
  middlewareList: Middleware[],
  fastifyRequest: FastifyRequest,
  fastifyReply: FastifyReply,
): Promise<boolean> {
  if (middlewareList.length === 0) {
    return false;
  }

  const { Request, Response } = await import("@warlock.js/core");

  const request = new Request();
  const response = new Response();

  response.setResponse(fastifyReply);
  request.response = response;
  response.request = request;
  request.setRequest(fastifyRequest);

  for (const middlewareFunction of middlewareList) {
    const result = await middlewareFunction({ request, response });

    if (result) {
      return true;
    }
  }

  return false;
}
