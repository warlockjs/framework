import Fastify from "fastify";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLazyStatic } from "./lazy-static";
import { startHttpServer } from "./server";
import {
  REFUSAL_STATUS,
  refusalStatusOf,
  requestAcceptsHtml,
  setRefusalDispatcher,
} from "./refusal-dispatch";

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,*/*;q=0.8";

async function publicServer() {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-refusal-"));
  mkdirSync(path.join(root, "public"));
  writeFileSync(path.join(root, "public", "a.txt"), "a");

  const server = Fastify();
  registerLazyStatic(server, { root: path.join(root, "public"), prefix: "/public/" });
  await server.listen({ port: 0, host: "127.0.0.1" });

  return server;
}

/** `inject()` normalises dot segments away, so these go over a real socket. */
function request(
  server: ReturnType<typeof Fastify>,
  url: string,
  accept?: string,
): Promise<{ status: number; type: string; body: string }> {
  const { port } = server.server.address() as { port: number };

  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: url, headers: accept ? { accept } : {} }, (reply) => {
        let body = "";

        reply.on("data", (chunk) => (body += chunk));
        reply.on("end", () =>
          resolve({
            status: reply.statusCode ?? 0,
            type: String(reply.headers["content-type"] ?? ""),
            body,
          }),
        );
      })
      .on("error", reject);
  });
}

const servers: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  setRefusalDispatcher(undefined);
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("requestAcceptsHtml", () => {
  it("needs an explicit text/html", () => {
    expect(requestAcceptsHtml(BROWSER_ACCEPT)).toBe(true);
    expect(requestAcceptsHtml(["application/json", "text/html"])).toBe(true);
    expect(requestAcceptsHtml("*/*")).toBe(false);
    expect(requestAcceptsHtml("text/html;q=0")).toBe(false);
    expect(requestAcceptsHtml(undefined)).toBe(false);
  });
});

describe("refusalStatusOf", () => {
  it("reads the stamp off a Fastify request or a Warlock request", () => {
    expect(refusalStatusOf({ [REFUSAL_STATUS]: 403 })).toBe(403);
    expect(refusalStatusOf({ baseRequest: { [REFUSAL_STATUS]: 400 } })).toBe(400);
    expect(refusalStatusOf({ baseRequest: {} })).toBeUndefined();
    expect(refusalStatusOf(undefined)).toBeUndefined();
  });
});

describe("a path-traversal refusal on the public mount", () => {
  it("is handed to the refusal dispatcher and answered by it", async () => {
    const dispatcher = vi.fn(async (_request, reply, status: number) => {
      reply.code(status).type("text/html").send("<h1>site forbidden</h1>");

      return true;
    });
    setRefusalDispatcher(dispatcher);
    const server = await publicServer();
    servers.push(server);

    const response = await request(server, "/public/../x", BROWSER_ACCEPT);

    expect(response.status).toBe(403);
    expect(response.type).toContain("text/html");
    expect(response.body).toBe("<h1>site forbidden</h1>");
    expect(dispatcher).toHaveBeenCalledWith(expect.anything(), expect.anything(), 403);
  });

  it("keeps the JSON 403 when the dispatcher declines (API client, no page host)", async () => {
    setRefusalDispatcher(async () => false);
    const server = await publicServer();
    servers.push(server);

    const response = await request(server, "/public/../x", "application/json");

    expect(response.status).toBe(403);
    expect(response.type).toContain("application/json");
    expect(JSON.parse(response.body)).toMatchObject({ statusCode: 403 });
  });

  it("keeps the JSON 403 when no dispatcher is installed at all", async () => {
    const server = await publicServer();
    servers.push(server);

    const response = await request(server, "/public/../x");

    expect(response.status).toBe(403);
    expect(response.type).toContain("application/json");
  });

  it("does not involve the dispatcher for a plain missing file (404)", async () => {
    const dispatcher = vi.fn(async () => true);
    setRefusalDispatcher(dispatcher);
    const server = await publicServer();
    servers.push(server);

    await request(server, "/public/missing.txt", BROWSER_ACCEPT);

    expect(dispatcher).not.toHaveBeenCalled();
  });
});

describe("a malformed URL, refused before any route exists", () => {
  it("is handed to the dispatcher, and keeps Fastify's JSON 400 when it declines", async () => {
    const dispatcher = vi.fn(async (_request, reply, status: number) => {
      reply.code(status).type("text/html").send("<h1>bad request page</h1>");

      return true;
    });
    setRefusalDispatcher(dispatcher);
    const server = startHttpServer();
    servers.push(server);
    await server.listen({ port: 0, host: "127.0.0.1" });

    const page = await request(server, "/%zz", BROWSER_ACCEPT);

    expect(page.status).toBe(400);
    expect(page.body).toBe("<h1>bad request page</h1>");

    setRefusalDispatcher(async () => false);

    const json = await request(server, "/%zz", "application/json");

    expect(json.status).toBe(400);
    expect(json.type).toContain("application/json");
  });
});
