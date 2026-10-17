// Run by runtimes-smoke.test.ts under Bun and Deno (never imported by vitest):
// boot core's real HTTP stack — Fastify, the framework plugins (CORS,
// multipart, cookies, the public-folder static server) and the router — from
// source on an OS-assigned port, then print `{ "port": n }` and serve until
// SIGTERM.
import config from "@mongez/config";
import { registerHttpPlugins } from "../../../../src/http/plugins";
import { startHttpServer } from "../../../../src/http/server";
import { Router } from "../../../../src/router/router";

const publicRoot = process.argv[2];

if (!publicRoot) {
  throw new Error("usage: serve-on-runtime.ts <public-root>");
}

config.set("storage.publicRoot", publicRoot);

function runtimeName(): string {
  return process.versions.bun ? "bun" : process.versions.deno ? "deno" : "node";
}

const router = Router.getInstance();

router.get("/runtime", () => ({ runtime: runtimeName() }));
router.post("/echo", ({ request }) => ({ name: request.input("name"), runtime: runtimeName() }));

const server = startHttpServer();

await registerHttpPlugins(server);
router.scan(server);
await server.listen({ port: 0, host: "127.0.0.1" });

const address = server.server.address();
const port = typeof address === "object" && address !== null ? address.port : undefined;

if (port === undefined) {
  throw new Error(`the server reported no TCP address (${String(address)})`);
}

process.stdout.write(`${JSON.stringify({ port })}\n`);

process.once("SIGTERM", () => {
  void server.close().then(() => process.exit(0));
});
