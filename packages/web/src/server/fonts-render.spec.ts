import config from "@mongez/config";
import { Response, type Request } from "@warlock.js/core";
import { createElement } from "react";
import { PassThrough } from "node:stream";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DefaultApp from "../components/default-app";
import { connectPageContext, type PageRouteEntry } from "./execute-page-request";
import { normalizePageModule } from "./normalize-page-module";
import { composeLayoutModules } from "./compose-layout-modules";
import { renderPageRequest } from "./render-page";
import { FONT_MANIFEST, prepareFonts } from "../fonts/prepare-fonts";
import type { WebFont } from "../fonts/types";

const manifest = vi.hoisted(() => ({ value: undefined as { clientDir: string } | undefined }));
vi.mock("./page-manifest", () => ({ consumePageManifest: () => manifest.value }));
const fonts: WebFont[] = [
  {
    family: "Display",
    variable: "--font-display",
    fallback: "Arial",
    files: [
      { path: "src/fonts/fixtures/web-font-fixture.woff2", preload: true },
      { path: "src/fonts/fixtures/web-font-fixture.woff2", weight: 700, preload: true },
    ],
  },
];
const directories: string[] = [];
let previousWeb: unknown;
beforeEach(() => {
  previousWeb = config.get("web");
  config.set("web", { fonts });
  connectPageContext({
    buildStore: (payload) => payload as never,
    getStore: () => undefined,
    run: async (_store, callback) => callback(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  manifest.value = undefined;
  config.set("web", previousWeb);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function entry(): PageRouteEntry {
  return {
    path: "/",
    name: "home",
    triple: {
      app: { default: DefaultApp },
      layout: {},
      page: { default: () => createElement("h1", null, "Condensed display heading") },
    },
  };
}
async function render(route = entry(), dataRequest = false, appRoot?: string) {
  const rendered = await renderPageRequest("/", {
    routes: [route],
    appRoot,
    dataRequest,
    createHttp: () => {
      const response = new Response();
      // Redirect settlement replays committed headers; no live HTTP reply is
      // attached in this renderer harness.
      vi.spyOn(response, "header").mockReturnValue(response);
      return {
        request: { locale: "en", path: "/", method: "GET" } as unknown as Request,
        response,
      };
    },
  });
  if (rendered instanceof Response) throw new Error("unexpected terminal response");
  let streamed = "";
  if (rendered.pipeableStream) {
    const output = new PassThrough();
    output.on("data", (chunk: Buffer) => {
      streamed += chunk.toString();
    });
    const ended = new Promise<void>((resolve, reject) => {
      output.on("end", resolve);
      output.on("error", reject);
    });
    rendered.pipeableStream.pipe(output);
    await ended;
  }
  return { ...rendered, streamed };
}

describe("fonts in rendered documents", () => {
  it.each(["development", "production"])(
    "links CSS and preloads once in %s HTML and the streamed head",
    async (mode) => {
      const prepared = prepareFonts(process.cwd(), fonts);
      const preload = prepared.document.preloads[0];
      if (!preload) throw new Error("missing font preload");
      if (mode === "production") {
        const clientDir = mkdtempSync(path.join(os.tmpdir(), "warlock-font-manifest-"));
        directories.push(clientDir);
        mkdirSync(path.join(clientDir, ".vite"));
        writeFileSync(path.join(clientDir, FONT_MANIFEST), JSON.stringify(prepared.document));
        manifest.value = { clientDir };
        config.set("web", {
          fonts: [{ ...fonts[0], files: [{ path: "missing-in-production.woff2" }] }],
        });
      }
      const rendered = await render();
      for (const html of [rendered.html, rendered.streamed]) {
        expect(html.match(/rel="preload" as="font"/g)).toHaveLength(1);
        expect(html).toContain(`type="font/woff2" href="${preload.href}" crossorigin="anonymous"`);
        expect(html).toContain(
          `rel="stylesheet" href="${mode === "production" ? prepared.document.stylesheetUrl : "/@warlock/fonts.css"}"`,
        );
        expect(html.indexOf('as="font"')).toBeLessThan(html.indexOf("</head>"));
      }
    },
  );
  it.each(["app", "layout", "page"] as const)(
    "respects the %s preload opt-out while retaining CSS",
    async (level) => {
      const route = entry();
      route.triple[level].fontPreload = false;
      const rendered = await render(route);
      expect(rendered.streamed).not.toContain('as="font"');
      expect(rendered.streamed).toContain("/@warlock/fonts.css");
    },
  );
  it("resolves development fonts against the configured application root", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "warlock-font-root-"));
    directories.push(root);
    copyFileSync(
      new URL("../fonts/fixtures/web-font-fixture.woff2", import.meta.url),
      path.join(root, "display.woff2"),
    );
    config.set("web", {
      fonts: [{ ...fonts[0], files: [{ path: "display.woff2", preload: true }] }],
    });
    expect((await render(entry(), false, root)).streamed).toContain('as="font"');
  });
  it("does not read font files or emit a head when a loader redirects", async () => {
    config.set("web", { fonts: [{ ...fonts[0], files: [{ path: "missing.woff2" }] }] });
    const route = entry();
    route.triple.page.loader = ({ response }) => response.redirect("/next");
    const rendered = await render(route);
    expect(rendered.status).toBe(302);
    expect(rendered.html).toBe("");
    expect(rendered.streamed).toBe("");
  });
  it("normalizes config and preserves an ancestor layout opt-out", () => {
    const outer = normalizePageModule({ config: { fontPreload: false } }, "layout", "layout.tsx");
    const inner = normalizePageModule(
      { config: { fontPreload: true } },
      "layout",
      "nested/layout.tsx",
    );
    expect(composeLayoutModules([outer, inner], 1).fontPreload).toBe(false);
    expect(() =>
      normalizePageModule({ config: { fontPreload: "false" } }, "root", "root.tsx"),
    ).toThrow("fontPreload must be a boolean");
  });
  it("does not add fonts for applications without declarations", async () => {
    config.set("web", {});
    const rendered = await render();
    expect(rendered.html).not.toContain("font-");
    expect(rendered.html).not.toContain("/@warlock/fonts");
  });
  it("does not read font sources or emit preloads on a data request", async () => {
    config.set("web", { fonts: [{ ...fonts[0], files: [{ path: "missing.woff2" }] }] });
    const rendered = await render(entry(), true);
    expect(rendered.html).not.toContain('as="font"');
  });
});
