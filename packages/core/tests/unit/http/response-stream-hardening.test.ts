import { log } from "@warlock.js/logger";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import http from "node:http";
import { connect } from "node:http2";
import { createConnection, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Request } from "../../../src/http/request";
import { Response, toSingleLineSseField } from "../../../src/http/response";
import { beginHttpDrain, startHttpServer } from "../../../src/http/server";

/**
 * Hardening of the long-lived responses (`sse()`, `stream()`) found in the
 * 5.30.0 review: disconnect handlers are isolated, a graceful drain's
 * `Connection: close` survives, and caller values cannot inject SSE fields.
 */

function bind(reply: FastifyReply): Response {
  const request = new Request();
  const response = new Response();

  response.request = request;
  response.setResponse(reply);
  request.response = response;

  return response;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

describe("onDisconnect handlers", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    app?.server.closeAllConnections();
    await app?.close();
    app = undefined;
  });

  it("a throwing handler is logged, and the handlers after it still run", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => log);
    const laterHandlerRan = deferred<boolean>();
    const streaming = deferred();

    app = Fastify();
    app.get("/sse", async (_request, reply) => {
      const sse = bind(reply).sse();

      sse.onDisconnect(() => {
        throw new Error("handler exploded");
      });
      sse.onDisconnect(() => laterHandlerRan.resolve(true));
      sse.comment("open");
      streaming.resolve();

      return reply;
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    const client = http.get({ host: "127.0.0.1", port, path: "/sse" });

    client.on("error", () => undefined);
    await streaming.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    client.destroy();

    await expect(laterHandlerRan.promise).resolves.toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      "http",
      "stream",
      expect.objectContaining({ message: "handler exploded" }),
      { source: "onDisconnect handler" },
    );
  });
});

describe("SSE field injection", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("toSingleLineSseField removes CR, LF and NUL", () => {
    expect(toSingleLineSseField("a\r\nb\nc\rd\0e")).toBe("abcde");
    expect(toSingleLineSseField(42)).toBe("42");
  });

  it("line breaks in event, id and comment text cannot start new fields or events", async () => {
    app = Fastify();
    app.get("/sse", async (_request, reply) => {
      const sse = bind(reply).sse();

      sse.send("tick\n\nevent: injected\ndata: owned", { ok: true }, "7\nretry: 1");
      sse.comment("note\ndata: injected");
      sse.end();

      return reply;
    });

    const result = await app.inject({ method: "GET", url: "/sse" });
    const lines = result.body.split("\n");

    expect(lines).toContain("event: tickevent: injecteddata: owned");
    expect(lines).toContain("id: 7retry: 1");
    // The comment's second line stays a comment.
    expect(lines).toContain(": data: injected");
    expect(lines.filter((line) => line.startsWith("event:"))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith("retry:"))).toBe(false);
    expect(lines.filter((line) => line.startsWith("data:"))).toEqual(['data: {"ok":true}']);
  });
});

describe("long-lived responses during a graceful drain", () => {
  let server: ReturnType<typeof startHttpServer> | undefined;

  afterEach(async () => {
    server?.server.closeAllConnections();
    await server?.close().catch(() => undefined);
    server = undefined;
  });

  async function connectionHeaderFor(
    type: "sse" | "stream",
    drainFirst: boolean,
    headers?: Record<string, string>,
    onHeaders?: (headers: Headers) => void,
  ): Promise<string | null> {
    server = startHttpServer();
    const started = deferred();
    const release = deferred();

    server.get("/long", async (_request: unknown, reply: FastifyReply) => {
      started.resolve();
      await release.promise;

      const response = bind(reply);

      if (type === "sse") {
        const sse = response.sse({ headers });

        sse.send("tick", { n: 1 });
        sse.end();
      } else {
        const stream = response.stream("text/plain", { headers });

        stream.send("chunk");
        stream.end();
      }

      return reply;
    });

    await server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = server.server.address() as AddressInfo;
    const pending = fetch(`http://127.0.0.1:${port}/long`);

    await started.promise;

    if (drainFirst) beginHttpDrain(server.server);

    release.resolve();

    const response = await pending;

    await response.text();
    onHeaders?.(response.headers);

    return response.headers.get("connection");
  }

  it("an SSE stream started after the drain began keeps Connection: close", async () => {
    await expect(connectionHeaderFor("sse", true)).resolves.toBe("close");
  });

  it("a stream started after the drain began keeps Connection: close", async () => {
    await expect(connectionHeaderFor("stream", true)).resolves.toBe("close");
  });

  it.each(["sse", "stream"] as const)(
    "caller keep-alive cannot override a draining %s reply",
    async (type) => {
      await expect(connectionHeaderFor(type, true, { Connection: "keep-alive" })).resolves.toBe(
        "close",
      );
    },
  );

  it.each([
    { type: "sse" as const, headers: undefined },
    { type: "stream" as const, headers: undefined },
    {
      type: "sse" as const,
      headers: {
        "transfer-encoding": "gzip",
        "content-length": "999",
        "content-type": "application/json",
        "keep-alive": "timeout=99",
        upgrade: "websocket",
        "proxy-connection": "keep-alive",
      },
    },
    {
      type: "stream" as const,
      headers: {
        "transfer-encoding": "gzip",
        "content-length": "999",
        "content-type": "application/json",
        "keep-alive": "timeout=99",
        upgrade: "websocket",
        "proxy-connection": "keep-alive",
      },
    },
  ])(
    "keeps chunked framing and keep-alive for $type with headers $headers",
    async ({ type, headers }) => {
      await expect(
        connectionHeaderFor(type, false, headers, (received) => {
          expect(received.get("transfer-encoding")).toBe("chunked");
          expect(received.get("content-type")).toContain(
            type === "sse" ? "text/event-stream" : "text/plain",
          );
          for (const name of ["content-length", "keep-alive", "upgrade", "proxy-connection"]) {
            expect(received.get(name)).toBeNull();
          }
        }),
      ).resolves.toBe("keep-alive");
    },
  );

  async function rawResponse(type: "sse" | "stream", reuse: boolean): Promise<string> {
    server = startHttpServer();
    server.get("/raw", async (_request: unknown, reply: FastifyReply) => {
      const response = bind(reply);
      const controller = type === "sse" ? response.sse() : response.stream();
      if (type === "sse") (controller as ReturnType<Response["sse"]>).send("tick", "ok");
      else (controller as ReturnType<Response["stream"]>).send("ok");
      controller.end();
      return reply;
    });
    await server.listen({ port: 0, host: "127.0.0.1" });
    return new Promise((resolve, reject) => {
      const socket = createConnection({
        host: "127.0.0.1",
        port: (server!.server.address() as AddressInfo).port,
      });
      let wire = "";
      let sentSecond = false;
      socket.setTimeout(2000, () => socket.destroy(new Error("response did not close")));
      socket.once("error", reject);
      socket.once("connect", () =>
        socket.write(`GET /raw HTTP/1.${reuse ? 1 : 0}\r\nHost: localhost\r\n\r\n`),
      );
      socket.on("data", (chunk) => {
        wire += chunk.toString();
        if (
          reuse &&
          sentSecond &&
          (wire.match(/HTTP\/1\.1 200 OK/g)?.length ?? 0) === 2 &&
          wire.endsWith("0\r\n\r\n")
        ) {
          socket.destroy();
          resolve(wire);
        }
        if (reuse && !sentSecond && wire.endsWith("0\r\n\r\n")) {
          sentSecond = true;
          socket.write("GET /raw HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        }
      });
      socket.once("end", () => {
        socket.destroy();
        resolve(wire);
      });
    });
  }

  it.each(["sse", "stream"] as const)("uses close-delimited %s for HTTP/1.0", async (type) => {
    const wire = await rawResponse(type, false);
    const [headers, body] = wire.split("\r\n\r\n");
    expect(headers.toLowerCase()).not.toContain("transfer-encoding");
    expect(headers.toLowerCase()).not.toContain("connection: keep-alive");
    expect(body).toBe(type === "sse" ? 'event: tick\ndata: "ok"\n\n' : "ok");
  });

  it.each(["sse", "stream"] as const)("reuses the HTTP/1.1 socket after %s end", async (type) => {
    const wire = await rawResponse(type, true);
    expect(wire.match(/HTTP\/1\.1 200 OK/g)).toHaveLength(2);
    expect(wire.toLowerCase()).toContain("transfer-encoding: chunked");
  });

  it("without a drain, an SSE stream still asks for keep-alive", async () => {
    await expect(connectionHeaderFor("sse", false)).resolves.toBe("keep-alive");
  });
});

it.each(["stream", "sse"] as const)(
  "serves %s over HTTP/2 without connection-specific headers",
  async (type) => {
    const app = Fastify({ http2: true });
    app.get("/events", async (_request, reply) => {
      const response = bind(reply as unknown as FastifyReply);
      response.header("Connection", "keep-alive").header("Transfer-Encoding", "chunked");
      const stream =
        type === "sse"
          ? response.sse({ headers: { Connection: "keep-alive" } })
          : response.stream("text/plain", { headers: { Connection: "keep-alive" } });
      if (type === "sse") (stream as ReturnType<Response["sse"]>).send("tick", { ok: true });
      else (stream as ReturnType<Response["stream"]>).send("hello");
      stream.end();
      return reply;
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const client = connect(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`);
    try {
      const request = client.request({ ":path": "/events" });
      const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
        request.on("response", resolve);
        request.on("error", reject);
        request.resume();
        request.end();
      });
      expect(headers[":status"]).toBe(200);
      expect(headers.connection).toBeUndefined();
      expect(headers["transfer-encoding"]).toBeUndefined();
    } finally {
      client.destroy();
      await app.close();
    }
  },
);
