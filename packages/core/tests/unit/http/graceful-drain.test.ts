import config from "@mongez/config";
import type { FastifyReply } from "fastify";
import { connect, createServer } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { beginHttpDrain, closeServerWithTimeout, startHttpServer, trackConnectionsForDrain } from "../../../src/http/server";

/**
 * a request in flight when graceful shutdown begins finishes its
 * response, the client keeps the keep-alive connection open, and Node's
 * `server.close()` waits on that now-idle connection until the shutdown
 * budget expires. These run over real loopback sockets with `fetch`, whose
 * default agent keeps connections alive like a browser does.
 */

type Gate = { promise: Promise<void>; release: () => void };

function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function unsetConfig(path: string) {
  const segments = path.split(".");
  const lastSegment = segments.pop() as string;
  let node: Record<string, any> = config.list();

  for (const segment of segments) {
    if (!node[segment]) return;
    node = node[segment];
  }

  delete node[lastSegment];
}

async function listen(server: ReturnType<typeof startHttpServer>): Promise<string> {
  await server.listen({ port: 0, host: "127.0.0.1" });

  const address = server.server.address() as AddressInfo;

  return `http://127.0.0.1:${address.port}`;
}

describe("graceful HTTP drain with keep-alive clients", () => {
  let server: ReturnType<typeof startHttpServer> | undefined;

  afterEach(async () => {
    unsetConfig("http.gracefulShutdown");
    server?.server.closeAllConnections();
    await server?.close().catch(() => undefined);
    server = undefined;
  });

  it("finishes an in-flight request, then closes its idle connection without waiting for the timeout", async () => {
    server = startHttpServer();
    const started = gate();
    const release = gate();

    server.get("/slow", async () => {
      started.release();
      await release.promise;

      return { done: true };
    });

    const baseUrl = await listen(server);
    const pending = fetch(`${baseUrl}/slow`);

    await started.promise;

    const startedAt = Date.now();
    const drained = closeServerWithTimeout(server, 3000);

    release.release();

    const response = await pending;

    expect(await response.json()).toEqual({ done: true });
    // The in-flight response is told to close its connection.
    expect(response.headers.get("connection")).toBe("close");

    await expect(drained).resolves.toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("reaps a connection whose response had already started streaming when shutdown began", async () => {
    server = startHttpServer();
    const started = gate();
    const release = gate();

    server.get("/stream", async (_request: unknown, reply: FastifyReply) => {
      reply.raw.writeHead(200, { "content-type": "text/plain" });
      reply.raw.write("first;");
      started.release();
      await release.promise;
      reply.raw.end("last");

      return reply;
    });

    const baseUrl = await listen(server);
    const pending = fetch(`${baseUrl}/stream`).then((response) => response.text());

    await started.promise;

    const startedAt = Date.now();
    const drained = closeServerWithTimeout(server, 3000);

    release.release();

    expect(await pending).toBe("first;last");
    await expect(drained).resolves.toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("retires a hijacked response that has not flushed headers yet", async () => {
    server = startHttpServer();
    const started = gate();
    const release = gate();
    server.get("/hijacked", async (_request: unknown, reply: FastifyReply) => {
      reply.hijack();
      started.release();
      await release.promise;
      reply.raw.writeHead(200, { "content-type": "text/plain" });
      reply.raw.end("done");
    });
    const baseUrl = await listen(server);
    const pending = fetch(`${baseUrl}/hijacked`);
    await started.promise;
    const drained = closeServerWithTimeout(server, 3000);
    release.release();
    const response = await pending;
    expect(response.headers.get("connection")).toBe("close");
    expect(await response.text()).toBe("done");
    await expect(drained).resolves.toBe(true);
  });

  it("does not track connections when forceCloseConnections is false", () => {
    config.set("http.gracefulShutdown.forceCloseConnections", false);
    server = startHttpServer();

    expect(beginHttpDrain(server.server)).toBe(false);
  });

  it("ignores servers it does not track", () => {
    expect(beginHttpDrain(undefined)).toBe(false);
    expect(beginHttpDrain({})).toBe(false);
  });
});


it("drains HTTP/2 sessions without connection-specific headers or cutting active streams", async () => {
  const raw = createServer();
  trackConnectionsForDrain(raw);
  const started = gate();
  const release = gate();
  raw.on("request", async (_request, response) => {
    started.release();
    await release.promise;
    response.end("complete");
  });
  await new Promise<void>(resolve => raw.listen(0, "127.0.0.1", resolve));
  const client = connect(`http://127.0.0.1:${(raw.address() as AddressInfo).port}`);
  const request = client.request({ ":path": "/slow" });
  let connection: unknown;
  request.on("response", headers => { connection = headers.connection; });
  const body = new Promise<string>((resolve, reject) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { text += chunk; });
    request.on("end", () => resolve(text));
    request.on("error", reject);
  });
  request.end();
  try {
    await started.promise;
    const closing = closeServerWithTimeout({ server: raw, close: () => new Promise<void>((resolve, reject) => raw.close(error => error ? reject(error) : resolve())) }, 2000);
    release.release();
    expect(await body).toBe("complete");
    await expect(closing).resolves.toBe(true);
    expect(connection).toBeUndefined();
  } finally {
    release.release();
    client.destroy();
    await new Promise<void>(resolve => raw.close(() => resolve()));
  }
});

it("starts and drains the framework HTTP/2 server with default options and an idle session", async () => {
  const app = startHttpServer({ http2: true });
  const started = gate();
  const release = gate();
  app.get("/slow", async (_request: unknown, reply: FastifyReply) => {
    started.release();
    await release.promise;
    return reply.send("complete");
  });
  const url = await listen(app);
  const active = connect(url);
  const idle = connect(url);
  await Promise.all([active, idle].map(client => new Promise<void>((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  })));
  const request = active.request({ ":path": "/slow" });
  let connection: unknown;
  request.on("response", headers => { connection = headers.connection; });
  const body = new Promise<string>((resolve, reject) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { text += chunk; });
    request.once("end", () => resolve(text));
    request.once("error", reject);
  });
  request.end();
  try {
    await started.promise;
    const start = Date.now();
    const closing = closeServerWithTimeout(app, 2000);
    release.release();
    expect(await body).toBe("complete");
    expect(connection).toBeUndefined();
    await expect(closing).resolves.toBe(true);
    expect(Date.now() - start).toBeLessThan(1500);
  } finally {
    release.release();
    active.destroy();
    idle.destroy();
    await app.close();
  }
});
