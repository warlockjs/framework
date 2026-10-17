import fastifyMultipart from "@fastify/multipart";
import config from "@mongez/config";
import { existsSync } from "node:fs";
import type { FastifyRequest } from "fastify";
import { log } from "@warlock.js/logger";
import { router } from "../router";
import { resolveStaticRateLimit } from "../router/resolve-route-rate-limit";
import { rootPath } from "../utils";
import { buildCorsOptions } from "./build-cors-options";
import { buildRateLimitOptions } from "./build-rate-limit-options";
import { registerLazyStatic } from "./lazy-static";
import { parseUrlencodedBody } from "./parse-urlencoded-body";
import type { FastifyInstance } from "./server";

export async function registerHttpPlugins(server: FastifyInstance) {
  // 👇🏻 register rate-limit plugin
  const rateLimitOptions = buildRateLimitOptions(config.get("http.rateLimit"));

  if (rateLimitOptions) {
    server.register(import("@fastify/rate-limit"), rateLimitOptions);
  } else if (router.list().some((route) => typeof route.rateLimit === "object")) {
    log.warn(
      "http",
      "rateLimit",
      "Routes declare `rateLimit`, but `http.rateLimit.enabled` is false so the rate-limit plugin is not registered: route rate limits (and their errorMessage) are inactive.",
    );
  }

  // 👇🏻 register cors plugin
  server.register(import("@fastify/cors"), buildCorsOptions());

  // 👇🏻 import multipart plugin
  server.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: {
      // file size could be up to 10MB
      fileSize: config.get("http.fileUploadLimit", 10 * 1024 * 1024),
      // every file part is buffered in memory (`attachFieldsToBody`), so cap the counts too;
      // hitting any limit makes @fastify/multipart throw an error with statusCode 413
      files: config.get("http.multipart.files", 10),
      fields: config.get("http.multipart.fields", 100),
      fieldSize: config.get("http.multipart.fieldSize", 1024 * 1024),
    },
  });

  // 👇🏻 parse application/x-www-form-urlencoded bodies (Apple's OAuth
  // `form_post` callback, plain HTML forms). Fastify only parses JSON and
  // text natively, so without this every urlencoded POST is rejected with
  // FST_ERR_CTP_INVALID_MEDIA_TYPE before it reaches a route.
  //
  // No `bodyLimit` option here: Fastify falls back to the server's own
  // `bodyLimit` (`server.ts`, from `http.bodyLimit`) whenever a content-type
  // parser doesn't set one — the exact limit JSON bodies are already held to.
  // Reading `http.bodyLimit` again here would duplicate that lookup and risk
  // the two silently drifting.
  server.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request: FastifyRequest, body: string, done: (err: Error | null, body?: any) => void) => {
      try {
        done(null, parseUrlencodedBody(body));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // 👇🏻 serve the public folder. Importing `@fastify/static` is not free (its
  // directory-listing module calls `os.cpus()` at load), so defer loading to
  // the first file request even when the public folder already exists.
  const publicRoot = resolvePublicRoot(config.get("storage.publicRoot", rootPath("public")));

  if (publicRoot !== undefined) {
    registerLazyStatic(
      server,
      {
        root: publicRoot,
        prefix: config.get("storage.publicPrefix", "/public/"),
      },
      // Exempt from the global limiter unless `http.rateLimit.staticFiles`.
      { rateLimit: resolveStaticRateLimit(undefined) },
    );
  }

  // 👇🏻 register cookie plugin
  server.register(import("@fastify/cookie"), {
    secret: config.get("http.cookies.secret"), // Optional: allow signed cookies
    parseOptions: config.get("http.cookies.options", {}),
  });

  // Install plugin onRoute hooks before the connector registers health and app
  // routes. after() waits for this queue without closing route registration.
  await server.after();
}

/**
 * The public folder(s) worth handing to `@fastify/static`, or `undefined`
 * when there is nothing to serve: `false`, or a single path that does not
 * exist. An array is passed through unchanged; `@fastify/static` validates
 * each entry itself.
 */
export function resolvePublicRoot(publicRoot: unknown): string | string[] | undefined {
  if (publicRoot === false || publicRoot === null || publicRoot === undefined) {
    return undefined;
  }

  if (Array.isArray(publicRoot)) {
    return publicRoot.length > 0 ? publicRoot : undefined;
  }

  if (typeof publicRoot === "string") {
    return existsSync(publicRoot) ? publicRoot : undefined;
  }

  return publicRoot as string;
}
