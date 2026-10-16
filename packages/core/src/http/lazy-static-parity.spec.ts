import type { FastifyStaticOptions } from "@fastify/static";
import Fastify, { type FastifyInstance, type InjectOptions } from "fastify";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { registerLazyStatic } from "./lazy-static";

const servers: FastifyInstance[] = [];
const roots: string[] = [];

function directory(): string {
  const root = mkdtempSync(path.join(tmpdir(), "warlock-static-parity-"));
  roots.push(root);
  writeFileSync(path.join(root, "asset.txt"), "0123456789");
  writeFileSync(path.join(root, ".hidden"), "hidden");
  mkdirSync(path.join(root, "nested"));
  writeFileSync(path.join(root, "nested/index.html"), "index");
  return root;
}

async function pair(options: FastifyStaticOptions, setup?: (server: FastifyInstance) => void) {
  const eager = Fastify();
  const lazy = Fastify();
  servers.push(eager, lazy);
  for (const server of [eager, lazy]) {
    server.setNotFoundHandler((_request, reply) => reply.code(404).send({ missing: true }));
    setup?.(server);
  }
  await eager.register(import("@fastify/static"), { ...options });
  registerLazyStatic(lazy, options);
  await Promise.all([eager.ready(), lazy.ready()]);
  return { eager, lazy };
}

async function same(
  pair: { eager: FastifyInstance; lazy: FastifyInstance },
  options: InjectOptions,
) {
  const expected = await pair.eager.inject(options);
  const actual = await pair.lazy.inject(options);
  expect(actual.statusCode).toBe(expected.statusCode);
  expect(actual.body).toBe(expected.body);
  for (const header of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
    "content-encoding",
    "vary",
    "location",
    "content-disposition",
    "x-static",
  ]) {
    expect(actual.headers[header], header).toEqual(expected.headers[header]);
  }
  return actual;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("lazy static sender preserves upstream behavior", () => {
  it("preserves headers, HEAD, ranges, caching, missing and forbidden paths", async () => {
    const both = await pair({
      root: directory(),
      prefix: "/assets/",
      maxAge: "1h",
      setHeaders(reply) {
        reply.header("x-static", "custom");
      },
    });
    const first = await same(both, { url: "/assets/asset.txt" });
    expect(first.body).toBe("0123456789");
    for (const request of [
      { method: "HEAD" as const, url: "/assets/asset.txt" },
      { url: "/assets/asset.txt", headers: { range: "bytes=2-5" } },
      { url: "/assets/asset.txt", headers: { "if-none-match": String(first.headers.etag) } },
      { url: "/assets/missing.txt" },
      { url: "/assets/%2e%2e/secret.txt" },
      { url: "/assets/nested/../asset.txt" },
      { url: "/assets//asset.txt" },
    ])
      await same(both, request);
  });

  it("keeps ordered root-array fallback including file URLs", async () => {
    const first = directory();
    const second = directory();
    writeFileSync(path.join(second, "second.txt"), "second root");
    const both = await pair({
      root: [pathToFileURL(first), pathToFileURL(second)],
      prefix: "/assets/",
    });
    expect((await same(both, { url: "/assets/asset.txt" })).body).toBe("0123456789");
    expect((await same(both, { url: "/assets/second.txt" })).body).toBe("second root");
  });

  it("preserves directory listing, index resolution, redirects and compressed files", async () => {
    const root = directory();
    writeFileSync(path.join(root, "asset.txt.gz"), gzipSync("0123456789"));
    const both = await pair({
      root,
      prefix: "/assets",
      redirect: true,
      list: { format: "json" },
      preCompressed: true,
    });
    for (const url of [
      "/assets",
      "/assets/nested",
      "/assets/nested/",
      "/assets/",
      "/assets/index.json",
    ])
      await same(both, { url });
    await same(both, { url: "/assets/asset.txt", headers: { "accept-encoding": "gzip" } });
    await same(both, { url: "/assets/asset.txt", headers: { "accept-encoding": "br" } });
  });

  it("keeps wildcard:false exact file routes, ignores, indexes and the application's fallback", async () => {
    const root = directory();
    writeFileSync(path.join(root, "ignored.txt"), "ignored");
    const both = await pair(
      { root, prefix: "/assets/", wildcard: false, redirect: true, globIgnore: ["ignored.*"] },
      (server) => {
        server.get("/*", async () => "application fallback");
      },
    );
    writeFileSync(path.join(root, "late.txt"), "created after ready");
    rmSync(path.join(root, "asset.txt"));
    for (const url of [
      "/assets/nested/index.html",
      "/assets/nested/",
      "/assets/nested",
      "/assets/.hidden",
      "/assets/ignored.txt",
      "/assets/late.txt",
      "/assets/missing.txt",
      "/assets/asset.txt",
    ])
      await same(both, { url });
    expect((await both.lazy.inject({ url: "/assets/late.txt" })).body).toBe("application fallback");
  });

  it("preserves allowedPath, dotfile controls and constrained routes", async () => {
    const both = await pair({
      root: directory(),
      prefix: "/assets/",
      dotfiles: "deny",
      constraints: { host: "assets.test" },
      allowedPath: (name, _root, request) =>
        !name.includes("asset.txt") || request.headers["x-allow"] === "yes",
    });
    for (const request of [
      { url: "/assets/asset.txt", headers: { host: "other.test" } },
      { url: "/assets/asset.txt", headers: { host: "assets.test" } },
      { url: "/assets/asset.txt", headers: { host: "assets.test", "x-allow": "yes" } },
      { url: "/assets/.hidden", headers: { host: "assets.test" } },
    ])
      await same(both, request);
  });

  it("preserves parameterized prefixes and prefixAvoidTrailingSlash", async () => {
    const parameterized = await pair({ root: directory(), prefix: "/:tenant/assets/" });
    await same(parameterized, { url: "/acme/assets/asset.txt" });
    const unseparated = await pair({
      root: directory(),
      prefix: "/assets",
      prefixAvoidTrailingSlash: true,
    });
    await same(unseparated, { url: "/assetsasset.txt" });
    await same(unseparated, { url: "/assets/asset.txt" });
  });

  it("keeps sendFile and download decorators on unrelated routes with serving disabled", async () => {
    const root = directory();
    const both = await pair({ root, serve: false }, (server) => {
      server.get("/send", (_request, reply) => reply.sendFile("asset.txt"));
      server.get("/download", async (_request, reply) =>
        reply.download("asset.txt", "download.txt", { cacheControl: false, ...{ root } }),
      );
    });
    await same(both, { url: "/send" });
    await same(both, { url: "/download" });
    await same(both, { url: "/asset.txt" });
  });

  it("validates roots and listing options at boot without importing the sender", () => {
    const server = Fastify();
    servers.push(server);
    expect(() => registerLazyStatic(server, { root: "relative" })).toThrow(/absolute path/);
    expect(() => registerLazyStatic(server, { root: [] })).toThrow(/one or more/);
    const root = directory();
    expect(() => registerLazyStatic(server, { root: [root, root] })).toThrow(/duplicate/);
    expect(() => registerLazyStatic(server, { root: [root], list: true })).toThrow(/multi-root/);
  });
});
