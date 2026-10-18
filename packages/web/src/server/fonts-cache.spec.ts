import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { Router, router } from "@warlock.js/core";
import { describe, expect, it } from "vitest";
import { prepareFonts } from "../fonts/prepare-fonts";
import { productionAssetsDirectoryOptions } from "./web-connector";
import { registerProductionPublicFiles } from "./register-production-public-files";

describe("declared font cache headers", () => {
  it("serves hashed fonts and CSS immutably while public fonts retain their existing cache", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "warlock-font-cache-"));
    const server = Fastify();
    try {
      const prepared = prepareFonts(process.cwd(), [
        {
          family: "Display",
          variable: "--font-display",
          fallback: "Arial",
          files: [{ path: "src/fonts/fixtures/web-font-fixture.woff2", preload: true }],
        },
      ]);
      for (const [file, source] of prepared.assets) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), source);
      }
      mkdirSync(path.join(root, "public"));
      writeFileSync(path.join(root, "public/legacy.woff2"), "legacy public font");
      router.directory(productionAssetsDirectoryOptions(root));
      registerProductionPublicFiles(router as unknown as Router, root, ["legacy.woff2"]);
      router.scan(server);
      const preload = prepared.document.preloads[0];
      if (!preload) throw new Error("missing font preload");
      for (const url of [preload.href, prepared.document.stylesheetUrl]) {
        const response = await server.inject({ method: "GET", url });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
        expect(response.headers["content-type"]).toContain(
          url.endsWith(".woff2") ? "font/woff2" : "text/css",
        );
      }
      const legacy = await server.inject({ method: "GET", url: "/legacy.woff2" });
      expect(legacy.statusCode).toBe(200);
      expect(legacy.headers["cache-control"]).toBe("public, max-age=300");
    } finally {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
