/**
 * Multipart bodies are capped in total, refused as soon as they pass the cap,
 * and (with `http.multipart.routes: "declared"`) parsed only on routes that
 * declare `uploads`.
 */
import config from "@mongez/config";
import Fastify from "fastify";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { registerMultipart } from "./multipart";

const BOUNDARY = "----warlock-spec-boundary";

type Part = { name: string; value: string; filename?: string };

function multipartBody(parts: Part[]): Buffer {
  const chunks: string[] = [];

  for (const part of parts) {
    chunks.push(`--${BOUNDARY}\r\n`);

    if (part.filename) {
      chunks.push(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`,
        "Content-Type: application/octet-stream\r\n\r\n",
      );
    } else {
      chunks.push(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`);
    }

    chunks.push(part.value, "\r\n");
  }

  chunks.push(`--${BOUNDARY}--\r\n`);

  return Buffer.from(chunks.join(""));
}

/** A body without `Content-Length`, so only the streaming count can refuse it. */
function chunked(body: Buffer): Readable {
  const pieces: Buffer[] = [];

  for (let offset = 0; offset < body.length; offset += 256) {
    pieces.push(body.subarray(offset, offset + 256));
  }

  return Readable.from(pieces);
}

async function buildServer(routes: Record<string, unknown> = {}) {
  const server = Fastify();

  registerMultipart(server as never);

  const handler = async (request: { body: unknown }) => {
    const body = request.body as Record<string, { type: string; toBuffer?: () => Promise<Buffer> }>;
    const sizes: Record<string, number> = {};

    for (const [key, part] of Object.entries(body ?? {})) {
      if (part.type === "file" && part.toBuffer) sizes[key] = (await part.toBuffer()).length;
    }

    return { sizes };
  };

  server.post("/open", handler);

  for (const [path, uploads] of Object.entries(routes)) {
    server.post(path, { config: { uploads } as never }, handler);
  }

  await server.ready();

  return server;
}

function post(
  server: Awaited<ReturnType<typeof buildServer>>,
  url: string,
  payload: Buffer | Readable,
) {
  return server.inject({
    method: "POST",
    url,
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload,
  });
}

describe("multipart total size", () => {
  afterEach(() => config.set("http.multipart", undefined));

  it("accepts and buffers uploads under the total", async () => {
    config.set("http.multipart", { maxTotalSize: 4000 });
    const server = await buildServer();

    const response = await post(
      server,
      "/open",
      multipartBody([{ name: "avatar", filename: "a.bin", value: "x".repeat(1500) }]),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sizes: { avatar: 1500 } });
  });

  it("refuses a declared Content-Length above the total before reading it", async () => {
    config.set("http.multipart", { maxTotalSize: 1000 });
    const server = await buildServer();

    const response = await post(
      server,
      "/open",
      multipartBody([{ name: "avatar", filename: "a.bin", value: "x".repeat(1500) }]),
    );

    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe("EC108");
  });

  it("refuses a streamed body once its files pass the total", async () => {
    config.set("http.multipart", { maxTotalSize: 1000 });
    const server = await buildServer();

    const response = await post(
      server,
      "/open",
      chunked(
        multipartBody([
          { name: "first", filename: "a.bin", value: "x".repeat(600) },
          { name: "second", filename: "b.bin", value: "y".repeat(600) },
        ]),
      ),
    );

    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe("EC108");
  });

  it("counts fields that arrive after the last file", async () => {
    config.set("http.multipart", { maxTotalSize: 1000 });
    const server = await buildServer();

    const response = await post(
      server,
      "/open",
      chunked(
        multipartBody([
          { name: "file", filename: "a.bin", value: "x".repeat(600) },
          { name: "note", value: "n".repeat(600) },
        ]),
      ),
    );

    expect(response.statusCode).toBe(413);
  });

  it("lets a route raise its own total with uploads.maxTotalSize", async () => {
    config.set("http.multipart", { maxTotalSize: 1000 });
    const server = await buildServer({ "/big": { maxTotalSize: 5000 } });

    const response = await post(
      server,
      "/big",
      multipartBody([{ name: "file", filename: "a.bin", value: "x".repeat(3000) }]),
    );

    expect(response.statusCode).toBe(200);
  });
});

describe('http.multipart.routes: "declared"', () => {
  afterEach(() => config.set("http.multipart", undefined));

  it("answers 415 on a route that does not declare uploads", async () => {
    config.set("http.multipart", { routes: "declared" });
    const server = await buildServer({ "/avatars": true });

    const response = await post(
      server,
      "/open",
      multipartBody([{ name: "file", filename: "a.bin", value: "x" }]),
    );

    expect(response.statusCode).toBe(415);
    expect(response.json().code).toBe("EC109");
  });

  it("parses multipart on a route with uploads: true", async () => {
    config.set("http.multipart", { routes: "declared" });
    const server = await buildServer({ "/avatars": true });

    const response = await post(
      server,
      "/avatars",
      multipartBody([{ name: "file", filename: "a.bin", value: "abc" }]),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sizes: { file: 3 } });
  });

  it('keeps every route open by default ("all")', async () => {
    const server = await buildServer();

    const response = await post(
      server,
      "/open",
      multipartBody([{ name: "file", filename: "a.bin", value: "abc" }]),
    );

    expect(response.statusCode).toBe(200);
  });
});
