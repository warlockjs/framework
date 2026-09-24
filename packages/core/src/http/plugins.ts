import fastifyMultipart from "@fastify/multipart";
import config from "@mongez/config";
import type { FastifyRequest } from "fastify";
import { log } from "@warlock.js/logger";
import { router } from "../router";
import { rootPath } from "../utils";
import { buildCorsOptions } from "./build-cors-options";
import { buildRateLimitOptions } from "./build-rate-limit-options";
import { parseUrlencodedBody } from "./parse-urlencoded-body";
import type { FastifyInstance } from "./server";

export async function registerHttpPlugins(server: FastifyInstance) {
  // 👇🏻 register rate-limit plugin
  const rateLimitOptions = buildRateLimitOptions(config.get("http.rateLimit"));

  if (rateLimitOptions) {
    server.register(import("@fastify/rate-limit"), rateLimitOptions);
  } else if (router.list().some((route) => route.rateLimit)) {
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

  server.register(import("@fastify/static"), {
    root: config.get("storage.publicRoot", rootPath("public")),
    prefix: config.get("storage.publicPrefix", "/public/"),
  });

  // 👇🏻 register cookie plugin
  server.register(import("@fastify/cookie"), {
    secret: config.get("http.cookies.secret"), // Optional: allow signed cookies
    parseOptions: config.get("http.cookies.options", {}),
  });
}
