import fastifyMultipart from "@fastify/multipart";
import config from "@mongez/config";
import type { FastifyRequest } from "fastify";
import { rootPath } from "../utils";
import { buildCorsOptions } from "./build-cors-options";
import { parseUrlencodedBody } from "./parse-urlencoded-body";
import type { FastifyInstance } from "./server";

export async function registerHttpPlugins(server: FastifyInstance) {
  // 👇🏻 register rate-limit plugin
  server.register(import("@fastify/rate-limit"), {
    // max requests per time window
    max: config.get("http.rateLimit.max", 60),
    // maximum time that is will allow max requests
    timeWindow: config.get("http.rateLimit.duration", 60 * 1000),
  });

  // 👇🏻 register cors plugin
  server.register(import("@fastify/cors"), buildCorsOptions());

  // 👇🏻 import multipart plugin
  server.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: {
      // file size could be up to 10MB
      fileSize: config.get("http.fileUploadLimit", 10 * 1024 * 1024),
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
