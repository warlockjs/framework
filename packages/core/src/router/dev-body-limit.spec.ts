/**
 * Per-route `serverOptions.bodyLimit` and `preParsing` in the dev dispatcher,
 * checked against production registration (`scan`): the same request has to
 * give the same status and error body in both.
 */
import http from "node:http";
import { Readable } from "node:stream";
import fastifyMultipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@warlock.js/logger";
import { DEV_BODY_LIMIT_CEILING, describeUnsupportedServerOptions } from "./dev-body-limit";
import { router } from "./router";

const MB = 1024 * 1024;

const json = (bytes: number) =>
  Buffer.from(JSON.stringify({ photos: "a".repeat(Math.max(0, bytes - 14)) }));

type Mode = "dev" | "production";

async function start(mode: Mode) {
  const server = Fastify({ forceCloseConnections: true });

  // The same upload plugin and limits the framework registers.
  await server.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: { fileSize: 10 * MB, fieldSize: 3 * MB },
  });

  if (mode === "dev") router.scanDevServer(server);
  else router.scan(server);

  await server.listen({ port: 0, host: "127.0.0.1" });

  return { server, port: (server.server.address() as { port: number }).port };
}

/**
 * POST a body with `content-length`. The headers go first: a route that
 * refuses the declared size answers 413 straight away, and the body is only
 * sent if no answer came within a short wait. Uploading a refused body makes
 * the server reset the connection, and on Windows that reset can discard the
 * 413 before it is read.
 */
function post(port: number, path: string, body: Buffer, contentType = "application/json") {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    let answered = false;
    const request = http.request(
      {
        port,
        host: "127.0.0.1",
        path,
        method: "POST",
        headers: { "content-type": contentType, "content-length": body.length },
      },
      (response) => {
        answered = true;
        clearTimeout(sendBody);
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        const done = () => {
          resolve({ status: response.statusCode ?? 0, body: text });
          request.destroy();
        };
        response.on("end", done);
        // A reset after the response arrived closes it without "end".
        response.on("close", done);
      },
    );

    request.on("error", (error) => {
      if (!answered) reject(error);
    });
    // The reset can also surface on the socket after the request is done.
    request.on("socket", (socket) => socket.on("error", () => {}));

    request.flushHeaders();
    const sendBody = setTimeout(() => request.end(body), 200);
  });
}

/** A body sent in chunks with no `content-length`. */
function postChunked(port: number, path: string, chunks: Buffer[]) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request(
      {
        port,
        host: "127.0.0.1",
        path,
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: text }));
      },
    );

    request.on("error", reject);

    for (const chunk of chunks) request.write(chunk);

    request.end();
  });
}

describe.each<Mode>(["dev", "production"])("route bodyLimit (%s)", (mode) => {
  let server: FastifyInstance | undefined;
  let port = 0;

  beforeEach(async () => {
    (router as any).routes = [];
    vi.spyOn(router as any, "handleRoute").mockImplementation(((route: any) =>
      async (request: any, reply: any) => {
        reply.code(200);

        return {
          output: {
            route: route.path,
            size: request.isMultipart() ? -1 : JSON.stringify(request.body ?? "").length,
          },
          response: { baseResponse: undefined },
        };
      }) as any);
    router.post("/photos", () => undefined, { serverOptions: { bodyLimit: 21 * MB } });
    router.post("/small", () => undefined);
    router.post("/tiny", () => undefined, { serverOptions: { bodyLimit: 1000 } });
    router.post("/files", () => undefined, { serverOptions: { bodyLimit: 21 * MB } });
    ({ server, port } = await start(mode));
  });

  afterEach(async () => {
    await server?.close();
    vi.restoreAllMocks();
    (router as any).routes = [];
  });

  it("accepts a body above the global limit on a route that raises it", async () => {
    const result = await post(port, "/photos", json(5 * MB));

    expect(result.status).toBe(200);
  });

  it("refuses a body above the route limit with Fastify's 413", async () => {
    const result = await post(port, "/photos", json(22 * MB));

    expect(result.status).toBe(413);
    expect(JSON.parse(result.body)).toEqual({
      statusCode: 413,
      code: "FST_ERR_CTP_BODY_TOO_LARGE",
      error: "Payload Too Large",
      message: "Request body is too large",
    });
  });

  it("keeps the global limit on other routes", async () => {
    expect((await post(port, "/small", json(2 * MB))).status).toBe(413);
    expect((await post(port, "/small", json(MB / 2))).status).toBe(200);
  });

  it("lowers the limit for a route that declares a smaller one", async () => {
    expect((await post(port, "/tiny", json(500))).status).toBe(200);
    expect((await post(port, "/tiny", json(2000))).status).toBe(413);
  });

  it("holds a chunked body without content-length to the route limit", async () => {
    const chunk = Buffer.alloc(MB, "a");
    const body = (megabytes: number) => [
      Buffer.from('{"p":"'),
      ...Array.from({ length: megabytes }, () => chunk),
      Buffer.from('"}'),
    ];

    expect((await postChunked(port, "/photos", body(3))).status).toBe(200);
    expect((await postChunked(port, "/small", body(2))).status).toBe(413);
  });

  it("refuses a chunked body over the route limit", async () => {
    const chunk = Buffer.alloc(MB, "a");
    const result = await postChunked(port, "/photos", [
      Buffer.from('{"p":"'),
      ...Array.from({ length: 22 }, () => chunk),
    ]);

    expect(result.status).toBe(413);
    expect(JSON.parse(result.body).code).toBe("FST_ERR_CTP_BODY_TOO_LARGE");
  });

  it("does not apply the body limit to multipart uploads", async () => {
    const boundary = "XBOUNDARY";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="a"\r\n\r\n`),
      Buffer.alloc(2 * MB, "a"),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const result = await post(port, "/small", payload, `multipart/form-data; boundary=${boundary}`);

    // Streamed by the upload plugin: bounded by its own limits, never by `bodyLimit`.
    expect(result.status).toBe(200);
  });
});

describe("route preParsing (dev)", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    vi.restoreAllMocks();
    (router as any).routes = [];
  });

  it("runs the matched route's preParsing hook and parses the stream it returns", async () => {
    (router as any).routes = [];
    vi.spyOn(router as any, "handleRoute").mockImplementation((() =>
      async (request: any, reply: any) => {
        reply.code(200);

        return { output: request.body, response: { baseResponse: undefined } };
      }) as any);
    const seen: string[] = [];
    router.post("/swap", () => undefined, {
      serverOptions: {
        preParsing: async (request: any) => {
          seen.push(request.url);

          return Readable.from([Buffer.from('{"swapped":true}')]);
        },
      },
    });
    router.post("/plain", () => undefined);
    ({ server } = await start("dev"));
    const port = (server.server.address() as { port: number }).port;

    const swapped = await post(port, "/swap", Buffer.from('{"swapped":"no"}'));
    const plain = await post(port, "/plain", Buffer.from('{"plain":1}'));

    expect(JSON.parse(swapped.body)).toEqual({ swapped: true });
    expect(JSON.parse(plain.body)).toEqual({ plain: 1 });
    expect(seen).toEqual(["/swap"]);
  });
});

describe("describeUnsupportedServerOptions", () => {
  it("names the route and the key for options the dev server drops", () => {
    const found = describeUnsupportedServerOptions([
      { method: "post", path: "/a", serverOptions: { onSend: () => undefined, bodyLimit: 5 } },
      { method: "get", path: "/b", serverOptions: { preParsing: () => undefined } },
      {
        method: "post",
        path: "/c",
        serverOptions: { bodyLimit: DEV_BODY_LIMIT_CEILING + 1 },
      },
    ] as any);

    expect(found.map((entry) => entry.message)).toEqual([
      expect.stringContaining("POST /a: serverOptions.onSend"),
      expect.stringContaining("POST /c: serverOptions.bodyLimit"),
    ]);
  });

  it("logs each warning once when the dev dispatcher boots", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => log);
    (router as any).routes = [];
    router.get("/x", () => undefined, {
      serverOptions: { onSend: (_r: any, _p: any, payload: any) => payload } as any,
    });
    const server = Fastify({ forceCloseConnections: true });

    router.scanDevServer(server);
    await server.ready();
    await server.close();

    expect(warn).toHaveBeenCalledWith(
      "router",
      "dev-dispatch",
      expect.stringContaining("GET /x: serverOptions.onSend"),
    );
    (router as any).routes = [];
    vi.restoreAllMocks();
  });
});
