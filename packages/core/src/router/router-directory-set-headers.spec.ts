import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { router } from "./router";

describe("router.directory setHeaders", () => {
  let server: FastifyInstance | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await server?.close();
    (router as any).staticDirectories = [];

    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes Fastify's reply to setHeaders", async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-router-directory-"));
    fs.writeFileSync(path.join(directory, "asset.txt"), "asset", "utf-8");

    let received: unknown;
    router.directory({
      root: directory,
      prefix: "/assets/",
      setHeaders(reply) {
        received = reply;
        reply.header("x-directory-set-headers", "set");
      },
    });

    server = Fastify();
    router.scan(server);
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/assets/asset.txt" });

    expect(response.statusCode).toBe(200);
    expect(received).toEqual(expect.objectContaining({ header: expect.any(Function) }));
    expect(response.headers["x-directory-set-headers"]).toBe("set");
  });
});
