import fs from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ComponentType, ReactNode } from "react";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_ROOT = path.join(WEB_ROOT, "src");
const toPosix = (file: string) => file.split(path.sep).join("/");

type PageModule = { Page: ComponentType; hookIdentity: unknown; revision: number };
type RootModule = {
  Provider: ComponentType<{
    locale: string;
    translations: Record<string, string>;
    children: ReactNode;
  }>;
  hookIdentity: unknown;
};
type RendererModule = {
  render(provider: RootModule["Provider"], page: PageModule["Page"], locale: string): string;
};

/**
 * Retain the provider as the dev page registry does, while Vite loads the edited
 * page. The context owner is a copy of the real current localization source,
 * allowing real watched edits without modifying the working tree's source.
 */
async function devHarness(shared: boolean) {
  const temporaryParent = path.join(WEB_ROOT, ".tmp");
  await fs.mkdir(temporaryParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryParent, "locale-context-hmr-"));
  const localeFile = path.join(root, "localization.tsx");
  const pageFile = path.join(root, "page.tsx");
  let vite: ViteDevServer | undefined;
  let currentPage: PageModule | undefined;
  const updatedFiles: string[] = [];
  let lastEdit = 0;
  const listeners = new Set<(file: string) => void>();
  const observer: Plugin = {
    name: "test:observe-locale-context-hmr",
    handleHotUpdate(context) {
      updatedFiles.push(context.file);
      for (const listener of listeners) listener(context.file);
    },
  };
  let localeSource = (await fs.readFile(path.join(SOURCE_ROOT, "localization.tsx"), "utf8"))
    .replace(
      '"./shared/shared-context"',
      JSON.stringify(toPosix(path.join(SOURCE_ROOT, "shared/shared-context.ts"))),
    )
    .replace(
      '"./routing/current-locale"',
      JSON.stringify(toPosix(path.join(SOURCE_ROOT, "routing/current-locale.ts"))),
    );
  if (!shared) {
    const before = localeSource;
    localeSource = localeSource.replace(
      /const\s+LocaleContext\s*=\s*sharedContext<LocaleValue\s*\|\s*undefined>\(\s*"WarlockLocaleContext",\s*undefined,?\s*\);/,
      "const LocaleContext = createContext<LocaleValue | undefined>(undefined);",
    );
    if (localeSource === before)
      throw new Error(
        "The unshared-context control did not replace the production context allocation.",
      );
    localeSource = 'import { createContext } from "react";\n' + localeSource;
  }
  const pageSource = (revision: number) => `
import { createElement } from "react";
import { useLocale, useTrans } from "./localization";
export const hookIdentity = useLocale;
export const revision = ${revision};
export function Page() {
  const locale = useLocale();
  const translate = useTrans();
  return createElement("output", null, revision + ":" + locale + ":" + translate("greeting"));
}
`;
  try {
    await fs.writeFile(localeFile, localeSource + "\nexport const hotRevision = 1;\n");
    await fs.writeFile(pageFile, pageSource(1));
    await fs.writeFile(
      path.join(root, "root.tsx"),
      'export { LocaleProvider as Provider, useLocale as hookIdentity } from "./localization";\n',
    );
    await fs.writeFile(
      path.join(root, "renderer.tsx"),
      `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
export function render(Provider, Page, locale) {
  return renderToStaticMarkup(createElement(Provider, {
    locale, translations: { greeting: locale === "ar" ? "مرحبا" : "hello" },
    children: createElement(Page),
  }));
}
`,
    );
    vite = await createServer({
      root,
      configFile: false,
      appType: "custom",
      logLevel: "silent",
      esbuild: { jsx: "automatic", jsxImportSource: "react" },
      optimizeDeps: { noDiscovery: true },
      ssr: { external: ["react", "react-dom", "@mongez/localization"] },
      server: {
        host: "127.0.0.1",
        port: 0,
        watch: { usePolling: true, interval: 20 },
        fs: { allow: [WEB_ROOT] },
      },
      plugins: [observer],
    });
    const server = vite;
    const initialRoot = (await server.ssrLoadModule("/root.tsx")) as RootModule;
    const renderer = (await server.ssrLoadModule("/renderer.tsx")) as RendererModule;
    currentPage = (await server.ssrLoadModule("/page.tsx")) as PageModule;
    server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith("/render")) return next();
      try {
        currentPage = (await server.ssrLoadModule("/page.tsx")) as PageModule;
        const locale = new URL(request.url, "http://localhost").searchParams.get("locale") ?? "ar";
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(renderer.render(initialRoot.Provider, currentPage.Page, locale));
      } catch (error) {
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
    await server.listen();
    await expect.poll(() => server.watcher.getWatched()[root]?.includes("page.tsx")).toBe(true);
    await expect
      .poll(() => server.watcher.getWatched()[root]?.includes("localization.tsx"))
      .toBe(true);
    const address = server.httpServer?.address() as AddressInfo | null;
    if (!address) throw new Error("Vite did not listen on an HTTP port.");
    const url = `http://127.0.0.1:${address.port}`;
    return {
      url,
      initialRoot,
      page: () => currentPage,
      updatedFiles,
      async edit(revision: number) {
        // Separate successive editor writes beyond chokidar's change-event
        // coalescing window; all invalidation still comes from the real watcher.
        const delay = Math.max(0, 150 - (Date.now() - lastEdit));
        if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
        lastEdit = Date.now();
        const expected = new Set([localeFile, pageFile]);
        const observed = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            listeners.delete(listener);
            reject(
              new Error(
                `Vite did not observe HMR edits: pending ${[...expected].map((file) => path.basename(file)).join(", ")}; observed ${updatedFiles.map((file) => path.basename(file)).join(", ")}`,
              ),
            );
          }, 8_000);
          const listener = (file: string) => {
            expected.delete(file);
            if (expected.size === 0) {
              clearTimeout(timeout);
              listeners.delete(listener);
              resolve();
            }
          };
          listeners.add(listener);
        });
        await fs.writeFile(
          localeFile,
          localeSource + `\nexport const hotRevision = ${revision};\n`,
        );
        await fs.writeFile(pageFile, pageSource(revision));
        await observed;
        await expect
          .poll(async () => ((await server.ssrLoadModule("/page.tsx")) as PageModule).revision)
          .toBe(revision);
      },
      async close() {
        await server.close();
        await fs.rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

describe("locale context under a real Vite dev-server HMR edit", () => {
  it("reproduces the outside-provider HTTP failure with an unshared context allocation", async () => {
    const harness = await devHarness(false);
    try {
      const before = await fetch(`${harness.url}/render?locale=ar`);
      expect(before.status).toBe(200);
      expect(await before.text()).toBe("<output>1:ar:مرحبا</output>");
      expect(harness.page()?.hookIdentity).toBe(harness.initialRoot.hookIdentity);
      await harness.edit(2);
      const after = await fetch(`${harness.url}/render?locale=ar`);
      expect(harness.page()?.hookIdentity).not.toBe(harness.initialRoot.hookIdentity);
      expect(after.status).toBe(500);
      expect(await after.text()).toContain(
        "useLocale() was called outside Warlock's LocaleProvider",
      );
    } finally {
      await harness.close();
    }
  }, 30_000);

  it("keeps locale and translations with a retained provider across repeated real HMR edits", async () => {
    const harness = await devHarness(true);
    try {
      const first = await fetch(`${harness.url}/render?locale=ar`);
      expect(first.status).toBe(200);
      expect(await first.text()).toBe("<output>1:ar:مرحبا</output>");
      for (const revision of [2, 3]) {
        await harness.edit(revision);
        for (const [locale, greeting] of [
          ["ar", "مرحبا"],
          ["en", "hello"],
        ]) {
          const response = await fetch(`${harness.url}/render?locale=${locale}`);
          expect(response.status).toBe(200);
          expect(await response.text()).toBe(`<output>${revision}:${locale}:${greeting}</output>`);
        }
        expect(harness.page()?.hookIdentity).not.toBe(harness.initialRoot.hookIdentity);
      }
      expect(harness.updatedFiles.filter((file) => file.endsWith("localization.tsx"))).toHaveLength(
        2,
      );
      expect(harness.updatedFiles.filter((file) => file.endsWith("page.tsx"))).toHaveLength(2);
    } finally {
      await harness.close();
    }
  }, 30_000);
});
