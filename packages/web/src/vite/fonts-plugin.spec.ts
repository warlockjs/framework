import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { build, createServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { webFontsPlugin } from "./fonts-plugin";
import { loadWebBuildConfig } from "../build/load-web-build-config";
import { DEV_FONT_CSS, FONT_MANIFEST } from "../fonts/prepare-fonts";
import type { FontDocument, WebFont } from "../fonts/types";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-font-build-"));
  roots.push(root);
  mkdirSync(path.join(root, "src/fonts"), { recursive: true });
  mkdirSync(path.join(root, "src/config"), { recursive: true });
  mkdirSync(path.join(root, "public"));
  copyFileSync(
    new URL("../fonts/fixtures/web-font-fixture.woff2", import.meta.url),
    path.join(root, "src/fonts/display.woff2"),
  );
  copyFileSync(
    new URL("../fonts/fixtures/web-font-fixture.woff2", import.meta.url),
    path.join(root, "public/body.woff2"),
  );
  const fonts: WebFont[] = [
    {
      family: "Display",
      variable: "--font-display",
      fallback: "Arial",
      files: [
        { path: "src/fonts/display.woff2", preload: true },
        { path: "public/body.woff2", weight: 700, preload: true },
      ],
    },
  ];
  writeFileSync(path.join(root, "entry.js"), "console.log('font build')");
  writeFileSync(
    path.join(root, "src/config/web.ts"),
    `export default { fonts: ${JSON.stringify(fonts)} };`,
  );
  return { root, fonts };
}

describe("declared fonts in Vite", () => {
  it("loads declarations from web config and emits hashed binary assets, CSS and a production manifest", async () => {
    const { root, fonts } = fixture();
    expect((await loadWebBuildConfig(root)).fonts).toEqual(fonts);
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      publicDir: false,
      plugins: [webFontsPlugin({ appRoot: root, fonts })],
      build: { outDir: "dist/client", rollupOptions: { input: path.join(root, "entry.js") } },
    });
    const client = path.join(root, "dist/client");
    const manifest = JSON.parse(
      readFileSync(path.join(client, FONT_MANIFEST), "utf8"),
    ) as FontDocument;
    expect(manifest.preloads).toHaveLength(1);
    const face = manifest.preloads[0];
    if (!face) throw new Error("missing font preload");
    expect(face.href).toMatch(/^\/assets\/font-[a-f0-9]{16}\.woff2$/);
    expect(readFileSync(path.join(client, face.href.slice(1)))).toEqual(
      readFileSync(path.join(root, "src/fonts/display.woff2")),
    );
    const css = readFileSync(path.join(client, manifest.stylesheetUrl.slice(1)), "utf8");
    expect(css).toContain(`url("${face.href}")`);
    expect(css).toContain("ascent-override:");
    expect(
      readdirSync(path.join(client, "assets")).filter((name) => name.endsWith(".woff2")),
    ).toHaveLength(1);
    // Fonts are never inlined, and no source path leaks into the manifest.
    expect(JSON.stringify(manifest)).not.toContain("src/fonts");
    expect(css).not.toContain("data:");
  });
  it("serves linked CSS and preloaded font bytes in development on an ephemeral HTTP port", async () => {
    const { root, fonts } = fixture();
    const vite = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false, watch: null },
      plugins: [webFontsPlugin({ appRoot: root, fonts })],
    });
    const server = createHttpServer((request, response) =>
      vite.middlewares(request, response, () => {
        response.statusCode = 404;
        response.end();
      }),
    );
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing ephemeral address");
      const origin = `http://127.0.0.1:${address.port}`;
      const css = await fetch(origin + DEV_FONT_CSS);
      expect(css.headers.get("content-type")).toContain("text/css");
      const text = await css.text();
      const href = /url\("([^"]+)"\)/.exec(text)?.[1];
      if (!href) throw new Error("missing font URL");
      const font = await fetch(origin + href);
      expect(font.headers.get("content-type")).toBe("font/woff2");
      expect(font.headers.get("cache-control")).toBe("no-cache");
      expect(Buffer.from(await font.arrayBuffer())).toEqual(
        readFileSync(path.join(root, "src/fonts/display.woff2")),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await vite.close();
    }
  });
});
