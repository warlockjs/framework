import type { FastifyReply, FastifyRequest } from "fastify";
import { Transform } from "node:stream";
import type { Readable } from "node:stream";

const rawBodies = new WeakMap<object, Buffer>();

/**
 * A pass-through stream that keeps the exact bytes of the request body while the
 * parser reads them. The copy is stored against the Fastify request once the
 * body ended, so it is ready before the handler runs.
 * @internal
 */
export function captureRawBody(request: FastifyRequest, payload: Readable): Readable {
  const chunks: Buffer[] = [];

  const tap = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);

      callback(null, chunk);
    },
    flush(callback) {
      rawBodies.set(request, Buffer.concat(chunks));

      callback();
    },
  });

  payload.on("error", (error) => tap.destroy(error));

  // Keep the encoded-length bookkeeping Fastify reads from a replaced stream.
  const received = (payload as { receivedEncodedLength?: number }).receivedEncodedLength;

  if (received !== undefined) {
    Object.defineProperty(tap, "receivedEncodedLength", {
      get: () => (payload as { receivedEncodedLength?: number }).receivedEncodedLength,
    });
  }

  return payload.pipe(tap);
}

/**
 * The `preParsing` hook a route with `rawBody: true` registers in production.
 * Multipart bodies are streamed by the upload plugin and never captured.
 * @internal
 */
export async function rawBodyPreParsing(
  request: FastifyRequest,
  _reply: FastifyReply,
  payload: Readable,
): Promise<Readable> {
  const contentType = String(request.headers["content-type"] ?? "").toLowerCase();

  if (contentType.startsWith("multipart/")) return payload;

  return captureRawBody(request, payload);
}

/** The exact request body bytes of a route declared with `rawBody: true`. */
export function readRawBody(request: object | undefined): Buffer | undefined {
  return request === undefined ? undefined : rawBodies.get(request);
}
