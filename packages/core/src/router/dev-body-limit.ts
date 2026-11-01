import { errorCodes } from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import type { Route } from "./types";

/**
 * The body limit the dev wildcard routes are registered with.
 *
 * Fastify reads `bodyLimit` once, when a route is registered, and a hot
 * reload cannot re-register the wildcard. The wildcard is therefore given a
 * ceiling no real request reaches, and every request is held to the limit of
 * the route it matched (or the global limit) by `createDevBodyLimitHook`, so a
 * route that raises or lowers its `serverOptions.bodyLimit` takes effect on
 * the next reload without a restart.
 */
export const DEV_BODY_LIMIT_CEILING = 2 * 1024 * 1024 * 1024;

type PayloadHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  payload: Readable,
  done?: (error?: Error | null, payload?: Readable) => void,
) => unknown;

/** `serverOptions.bodyLimit` as Fastify would accept it, or `undefined`. */
export function resolveRouteBodyLimit(route: Pick<Route, "serverOptions">): number | undefined {
  const limit = (route.serverOptions as { bodyLimit?: unknown } | undefined)?.bodyLimit;

  return typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

/**
 * Counts bytes as they pass and fails with Fastify's own
 * `FST_ERR_CTP_BODY_TOO_LARGE` the moment `limit` is exceeded, so a chunked
 * body is refused without buffering the rest of it.
 */
function limitPayload(source: Readable, limit: number): Readable {
  let received = 0;

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;

      if (received > limit) {
        callback(new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE());

        return;
      }

      callback(null, chunk);
    },
  });

  counter.on("error", () => {
    // The refusal is answered; drain the rest instead of buffering it.
    source.unpipe(counter);
    source.resume();
  });

  source.on("error", (error) => counter.destroy(error));

  return source.pipe(counter);
}

async function runPayloadHooks(
  hooks: PayloadHook[],
  request: FastifyRequest,
  reply: FastifyReply,
  payload: Readable,
): Promise<Readable> {
  let current = payload;

  for (const hook of hooks) {
    if (reply.sent) return current;

    // Fastify tells callback-style hooks apart by their arity.
    const next = await (hook.length >= 4
      ? new Promise<Readable | undefined>((resolve, reject) =>
          hook.call(request.server, request, reply, current, (error, value) =>
            error ? reject(error) : resolve(value),
          ),
        )
      : hook.call(request.server, request, reply, current));

    if (next && next !== (reply as unknown)) current = next as Readable;
  }

  return current;
}

/**
 * `preParsing` for the dev wildcard dispatcher, with the outcome production
 * gets from per-route registration:
 *
 * 1. the matched route's own `serverOptions.preParsing` hooks run, and may
 *    replace the payload stream;
 * 2. the route's `serverOptions.bodyLimit` (the global `http.bodyLimit`
 *    otherwise) is enforced: a declared `content-length` above it is refused
 *    before a byte is read, and a chunked or unannounced body is counted as it
 *    streams and refused the moment it passes the limit.
 *
 * Both refusals are Fastify's `FST_ERR_CTP_BODY_TOO_LARGE`, so the status and
 * the error shape are the ones production answers with. Multipart uploads are
 * streamed by their own plugin and bounded by `http.fileUploadLimit`, never by
 * the body limit, in dev and production alike.
 */
export function createDevBodyLimitHook(
  getRoute: (request: FastifyRequest) => Route | undefined,
  globalLimit: (request: FastifyRequest) => number,
) {
  return async (request: FastifyRequest, reply: FastifyReply, payload: Readable) => {
    const route = getRoute(request);

    let stream = payload;

    if (route?.serverOptions?.preParsing) {
      const hooks = ([] as unknown[]).concat(route.serverOptions.preParsing) as PayloadHook[];

      stream = await runPayloadHooks(hooks, request, reply, payload);

      if (reply.sent) return stream;
    }

    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    const announced = request.headers["content-length"];
    const hasBody = announced !== undefined || request.headers["transfer-encoding"] !== undefined;

    if (!hasBody || contentType.startsWith("multipart/")) {
      return stream === payload ? undefined : stream;
    }

    const limit = (route && resolveRouteBodyLimit(route)) ?? globalLimit(request);

    if (Number(announced) > limit) {
      throw new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE();
    }

    return limitPayload(stream, limit);
  };
}

/**
 * The `serverOptions` keys the dev dispatcher cannot honour. They are read by
 * Fastify when a route is registered, and the dev server registers one
 * wildcard instead of the app's routes.
 */
const UNSUPPORTED_DEV_SERVER_OPTIONS = [
  "schema",
  "attachValidation",
  "validatorCompiler",
  "serializerCompiler",
  "errorHandler",
  "constraints",
  "preSerialization",
  "onSend",
  "onResponse",
  "onError",
  "onTimeout",
  "onRequestAbort",
  "handler",
] as const;

/**
 * One warning line for each route that declares a `serverOptions` key the dev
 * server ignores, plus each `bodyLimit` above `DEV_BODY_LIMIT_CEILING`, so a
 * dev/production difference is visible at boot instead of found in production.
 */
export function describeUnsupportedServerOptions(
  routes: readonly Pick<Route, "method" | "path" | "serverOptions">[],
): { key: string; message: string }[] {
  const found: { key: string; message: string }[] = [];

  for (const route of routes) {
    const options = route.serverOptions as Record<string, unknown> | undefined;

    if (!options) continue;

    for (const key of UNSUPPORTED_DEV_SERVER_OPTIONS) {
      if (options[key] === undefined) continue;

      found.push({
        key: `${route.method} ${route.path} ${key}`,
        message: `${route.method.toUpperCase()} ${route.path}: serverOptions.${key} is not applied by the dev server (it is applied in a production build).`,
      });
    }

    const limit = resolveRouteBodyLimit(route);

    if (limit !== undefined && limit > DEV_BODY_LIMIT_CEILING) {
      found.push({
        key: `${route.method} ${route.path} bodyLimit`,
        message: `${route.method.toUpperCase()} ${route.path}: serverOptions.bodyLimit (${limit}) is above the dev server ceiling (${DEV_BODY_LIMIT_CEILING}); the dev server refuses bodies above the ceiling.`,
      });
    }
  }

  return found;
}
