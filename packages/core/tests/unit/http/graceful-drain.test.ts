import config from "@mongez/config";
import type { FastifyReply } from "fastify";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { beginHttpDrain, closeServerWithTimeout, startHttpServer } from "../../../src/http/server";

/**
 * WR-014: a request in flight when graceful shutdown begins finishes its
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
