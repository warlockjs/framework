import fastifyMultipart, { type MultipartFields, type MultipartFile } from "@fastify/multipart";
import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import type { FastifyRequest } from "fastify";
import { environment } from "../utils/environment";
import { HttpErrorCodes } from "./error-codes";
import { createRequestRefusal } from "./request-refusal";
import type { FastifyInstance } from "./server";

/** Default for `http.multipart.maxTotalSize`: 25 MB across all parts. */
export const DEFAULT_MULTIPART_MAX_TOTAL_SIZE = 25 * 1024 * 1024;

/** Which routes parse multipart bodies (`http.multipart.routes`). */
export type MultipartRoutesMode = "declared" | "all";

/** A route's `uploads` option. */
export type RouteUploadsOption = boolean | { maxTotalSize?: number };

type MultipartState = {
  maxTotalSize: number;
  fileBytes: number;
};

const states = new WeakMap<FastifyRequest, MultipartState>();

let warnedAllRoutes = false;

/**
 * Register `@fastify/multipart` with the framework's limits:
 *
 * - per part and per count (`http.fileUploadLimit`, `http.multipart.files`,
 *   `fields`, `fieldSize`), enforced by the plugin;
 * - a total across every part (`http.multipart.maxTotalSize`, or a route's
 *   `uploads.maxTotalSize`), counted while files stream in, so a request is
 *   refused with 413 as soon as it passes the cap instead of after it is
 *   fully buffered. A declared `Content-Length` above the cap is refused
 *   before a single byte is read;
 * - `http.multipart.routes: "declared"` parses multipart only on routes that
 *   set `uploads`, and answers 415 everywhere else.
 */
export function registerMultipart(server: FastifyInstance) {
  const configuredMode = config.get("http.multipart.routes");
  const mode: MultipartRoutesMode = configuredMode === "declared" ? "declared" : "all";

  if (configuredMode == null && environment() === "production" && !warnedAllRoutes) {
    warnedAllRoutes = true;

    log.warn(
      "http",
      "multipart",
      'Every route accepts multipart uploads, parsed before route middleware (auth included) runs. Set http.multipart.routes to "declared" and add `uploads: true` to the routes that take files.',
    );
  }

  // Runs before the plugin's own parsing hook: registered now, while the
  // plugin itself is only queued.
  server.addHook("preValidation", async (request: FastifyRequest) => {
    if (!isMultipartRequest(request)) return;

    const uploads = routeUploadsOption(request);

    if (mode === "declared" && !uploads) {
      throw createRequestRefusal(
        415,
        HttpErrorCodes.MultipartNotAccepted,
        'This route does not accept file uploads. Add `uploads: true` to the route, or set http.multipart.routes to "all".',
      );
    }

    const maxTotalSize = resolveMaxTotalSize(uploads);

    states.set(request, { maxTotalSize, fileBytes: 0 });

    const declaredLength = Number(request.headers["content-length"]);

    if (Number.isFinite(declaredLength) && declaredLength > maxTotalSize) {
      throw multipartTooLarge(maxTotalSize);
    }
  });

  server.register(fastifyMultipart, {
    attachFieldsToBody: true,
    // Buffer each file part like the plugin would, while counting the bytes
    // of the whole request against the total cap.
    onFile: bufferFilePart,
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

  // Fields that arrive after the last file never pass through `onFile`:
  // check the finished body once the plugin's parsing hook has run.
  server.after(() => {
    server.addHook("preValidation", async (request: FastifyRequest) => {
      const state = states.get(request);

      if (!state) return;

      states.delete(request);

      if (state.fileBytes + fieldBytes(request.body as MultipartFields) > state.maxTotalSize) {
        throw multipartTooLarge(state.maxTotalSize);
      }
    });
  });
}

/**
 * Read one file part into memory (the buffer `UploadedFile` reads back
 * through `toBuffer()`), refusing the request once its parts pass the total.
 */
export async function bufferFilePart(this: FastifyRequest, part: MultipartFile): Promise<void> {
  const state = states.get(this) ?? { maxTotalSize: resolveMaxTotalSize(undefined), fileBytes: 0 };

  states.set(this, state);

  // fields do not change while a file part streams
  const fieldsSoFar = fieldBytes(part.fields);
  const chunks: Buffer[] = [];

  for await (const chunk of part.file) {
    state.fileBytes += (chunk as Buffer).length;

    if (state.fileBytes + fieldsSoFar > state.maxTotalSize) {
      // leaving the loop destroys the part's stream and stops the parse
      throw multipartTooLarge(state.maxTotalSize);
    }

    chunks.push(chunk as Buffer);
  }

  if (part.file.truncated) {
    const error = new this.server.multipartErrors.RequestFileTooLargeError();

    (error as { part?: MultipartFile }).part = part;

    throw error;
  }

  const buffer = Buffer.concat(chunks);

  // the plugin's own `toBuffer()` returns this cached buffer
  (part as MultipartFile & { _buf: Buffer | null })._buf = buffer;
}

function isMultipartRequest(request: FastifyRequest): boolean {
  return typeof request.isMultipart === "function" && request.isMultipart();
}

/**
 * The matched route's `uploads` option: production registers it in the
 * route's Fastify config; the development dispatcher keeps the matched route
 * on the request.
 */
function routeUploadsOption(request: FastifyRequest): RouteUploadsOption | undefined {
  const fromConfig = (request.routeOptions?.config as { uploads?: RouteUploadsOption } | undefined)
    ?.uploads;

  if (fromConfig !== undefined) return fromConfig;

  return (request as { matchedDevRoute?: { route?: { uploads?: RouteUploadsOption } } })
    .matchedDevRoute?.route?.uploads;
}

function resolveMaxTotalSize(uploads: RouteUploadsOption | undefined): number {
  const routeLimit =
    typeof uploads === "object" && uploads !== null ? uploads.maxTotalSize : undefined;

  if (isPositiveInteger(routeLimit)) return routeLimit;

  const configured = config.get("http.multipart.maxTotalSize");

  return isPositiveInteger(configured) ? configured : DEFAULT_MULTIPART_MAX_TOTAL_SIZE;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function multipartTooLarge(maxTotalSize: number) {
  return createRequestRefusal(
    413,
    HttpErrorCodes.MultipartTooLarge,
    `The upload is larger than ${maxTotalSize} bytes in total. Send smaller files, or raise http.multipart.maxTotalSize (or the route's uploads.maxTotalSize).`,
  );
}

/** Bytes of the non-file field values received so far. */
function fieldBytes(fields: MultipartFields | undefined): number {
  if (!fields || typeof fields !== "object") return 0;

  let total = 0;

  for (const entry of Object.values(fields)) {
    const parts = Array.isArray(entry) ? entry : [entry];

    for (const part of parts) {
      if (!part || part.type !== "field") continue;

      const value = part.value;

      total +=
        typeof value === "string"
          ? Buffer.byteLength(value)
          : Buffer.byteLength(JSON.stringify(value) ?? "");
    }
  }

  return total;
}
