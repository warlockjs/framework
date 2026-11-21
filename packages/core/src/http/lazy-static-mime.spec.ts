import fastify from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerLazyStatic } from "./lazy-static";

describe("lazy static content types", () => {
  it("serves .apk with its registered media type", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wjs-static-"));
    mkdirSync(path.join(root, "downloads"));
    writeFileSync(path.join(root, "downloads", "x.apk"), "PK\u0003\u0004");
    const server = fastify();
    registerLazyStatic(server, { root, prefix: "/public/" });
    await server.ready();
    const response = await server.inject({ method: "GET", url: "/public/downloads/x.apk" });
    expect(response.headers["content-type"]).toBe("application/vnd.android.package-archive");
    await server.close();
  });
});
