/**
 * Dev SSR must share the process's stateful framework singletons.
 *
 * `core` initialises `@warlock.js/cache` (and its logger, context and
 * data-source registries) in the Node process at boot. The page pipeline runs
 * inside Vite's SSR module runner, and every module the runner INLINES is a
 * fresh instance with none of that boot state — a `serverCache: true` route
 * then answers 500 `CacheDriverNotInitializedError`.
 *
 * `ssr.external` alone does not protect them: Vite skips externalisation for
 * any specifier that matches `resolve.alias` (`importAnalysis`:
 * `if (ssr && !matchAlias(specifier))`), so an application alias such as
 * `^@warlock\.js/cache$ -> cache/src/index.ts` silently re-inlines the package.
 * These specs transform a probe module through the REAL dev config with those
 * aliases present and read what the SSR runner would import.
 */
import fs from "node:fs";
import { createServer as createNodeServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebConnectorViteConfig, siteAllowedHosts } from "./dev-server-config";
import { RESOLVED_CLIENT_PAGE_REGISTRY_ID } from "./page-registry-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..", "..");
const PACKAGES_ROOT = path.resolve(WEB_ROOT, "..");
const WORKSPACE_ROOT = path.resolve(PACKAGES_ROOT, "..");

const SINGLETON_PACKAGES = ["core", "cache", "logger", "context", "cascade"] as const;

describe("dev SSR config: stateful framework packages stay external", () => {
  let appRoot: string;
  let vite: ViteDevServer;
  const hmrServer = createNodeServer();

  beforeAll(async () => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-dev-ssr-"));
    fs.mkdirSync(path.join(appRoot, "src"));
    fs.writeFileSync(path.join(appRoot, "view.tsx"), "export const View = () => <div>hi</div>;\n");
    fs.writeFileSync(
      path.join(appRoot, "probe.ts"),
      [
        ...SINGLETON_PACKAGES.map(
          (name) => `export const load_${name} = () => import("@warlock.js/${name}");`,
        ),
        `export const loadWeb = () => import("@warlock.js/web");`,
      ].join("\n"),
    );

    const config = await createWebConnectorViteConfig({
      appRoot,
      appSrcRoot: path.join(appRoot, "src"),
      webRoot: WEB_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      hmrServer,
      handlePageHotUpdate: async () => false,
      leadingPlugins: [],
      // The workspace-checkout shape (`v5/app/warlock.config.ts`): every
      // sibling aliased to its TypeScript source.
      resolveAlias: [...SINGLETON_PACKAGES, "web"].map((name) => ({
        find: new RegExp(`^@warlock\\.js/${name}$`),
        replacement: path.join(PACKAGES_ROOT, name, "src", "index.ts"),
      })),
    });

    vite = await createServer({
      ...config,
      configFile: false,
      logLevel: "silent",
      optimizeDeps: { ...config.optimizeDeps, noDiscovery: true, include: [] },
      server: { ...config.server, hmr: false, watch: null },
    });
  });

  afterAll(async () => {
    await vite?.close();
    hmrServer.close();
    fs.rmSync(appRoot, { recursive: true, force: true });
  });

  it.each(SINGLETON_PACKAGES)(
    "leaves @warlock.js/%s as a bare, runner-external import even when the app aliases it",
    async (name) => {
      const result = await vite.environments.ssr.transformRequest(path.join(appRoot, "probe.ts"));

      expect(result?.code).toContain(`__vite_ssr_dynamic_import__("@warlock.js/${name}")`);
      expect(result?.code).not.toContain(`/${name}/src/index.ts`);
    },
  );

  it("transforms JSX with the automatic runtime through Oxc, with no deprecated esbuild option", async () => {
    const config = await createWebConnectorViteConfig({
      appRoot,
      appSrcRoot: path.join(appRoot, "src"),
      webRoot: WEB_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      hmrServer,
      handlePageHotUpdate: async () => false,
      leadingPlugins: [],
    });
    const result = await vite.environments.ssr.transformRequest(path.join(appRoot, "view.tsx"));

    expect("esbuild" in config).toBe(false);
    expect(config.oxc).toMatchObject({ jsx: { runtime: "automatic" } });
    expect(result?.code).toContain("react/jsx-");
    expect(result?.code).not.toContain("React.createElement");
  });

  it("keeps the app's alias for @warlock.js/web, which dev SSR deliberately inlines", async () => {
    const result = await vite.environments.ssr.transformRequest(path.join(appRoot, "probe.ts"));

    expect(result?.code).toContain("/web/src/index.ts");
  });

  it("externalises every stateful framework package in ssr.external", async () => {
    const config = await createWebConnectorViteConfig({
      appRoot,
      appSrcRoot: path.join(appRoot, "src"),
      webRoot: WEB_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      hmrServer,
      handlePageHotUpdate: async () => false,
      leadingPlugins: [],
    });

    for (const name of SINGLETON_PACKAGES) {
      expect(config.ssr?.external).toContain(`@warlock.js/${name}`);
    }
  });
});

/**
 * The externalisation rule must be DERIVED from `@warlock.js/*` membership,
 * not a hand-maintained list: `1726e3b` externalised core, cache, logger,
 * context and cascade by name, and the very next family package (auth here)
 * would have repeated the 5.0.2 / 5.13 defect if nobody remembered to add it.
 * These specs cover a package that was NEVER in that hand list, plus a deep
 * subpath import, and prove `@warlock.js/web` — the one package dev SSR must
 * keep inside Vite's graph — still is not swept in by the same rule.
 */
describe("dev SSR config: the family rule covers packages the old hand list never named", () => {
  it("externalises a family package the 1726e3b hand list never mentioned", async () => {
    const config = await createWebConnectorViteConfig({
      appRoot: WORKSPACE_ROOT,
      appSrcRoot: path.join(WORKSPACE_ROOT, "src"),
      webRoot: WEB_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      hmrServer: createNodeServer(),
      handlePageHotUpdate: async () => false,
      leadingPlugins: [],
    });

    expect(config.ssr?.external).toContain("@warlock.js/auth");
  });

  it("externalises a deep subpath import of a family package by its package name", async () => {
    const config = await createWebConnectorViteConfig({
      appRoot: WORKSPACE_ROOT,
      appSrcRoot: path.join(WORKSPACE_ROOT, "src"),
      webRoot: WEB_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      hmrServer: createNodeServer(),
      handlePageHotUpdate: async () => false,
      leadingPlugins: [],
    });

    // Vite reduces `@warlock.js/queue/notifications` to its package name
    // (`getNpmPackageName`) before checking `ssr.external`, so the deep
    // import is covered by the same bare entry a top-level import needs.
    expect(config.ssr?.external).toContain("@warlock.js/queue");
  });

  it("does not externalise @warlock.js/web, which dev SSR deliberately inlines", async () => {
    const config = await createWebConnectorViteConfig({
      appRoot: WORKSPACE_ROOT,
      appSrcRoot: path.join(WORKSPACE_ROOT, "src"),
      webRoot: WEB_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      hmrServer: createNodeServer(),
      handlePageHotUpdate: async () => false,
      leadingPlugins: [],
    });

    expect(config.ssr?.external).not.toContain("@warlock.js/web");
    expect(config.ssr?.noExternal).toContain("@warlock.js/web");
  });
});

/**
 * A caller-configured `appSrcRoot` that differs from `<appRoot>/src` must
 * still be the tree the dev client page registry discovers pages from —
 * otherwise a custom source root's pages silently never reach the browser.
 */
describe("dev SSR config: the client page registry honours a custom appSrcRoot", () => {
  it("discovers a page under a non-default appSrcRoot", async () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-custom-src-root-"));
    const appSrcRoot = path.join(appRoot, "custom-src");
    const pageFile = path.join(appSrcRoot, "web", "home.page.tsx");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      pageFile,
      [
        `export const config = { route: { path: "/home" } };`,
        `export default function Home() { return null; }`,
      ].join("\n"),
      "utf-8",
    );

    const hmrServer = createNodeServer();
    const config = await createWebConnectorViteConfig({
      appRoot,
      appSrcRoot,
      webRoot: WEB_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      hmrServer,
      handlePageHotUpdate: async () => false,
      leadingPlugins: [],
    });

    const vite = await createServer({
      ...config,
      configFile: false,
      logLevel: "silent",
      optimizeDeps: { ...config.optimizeDeps, noDiscovery: true, include: [] },
      server: { ...config.server, hmr: false, watch: null },
    });

    try {
      const result = await vite.environments.client.transformRequest(
        RESOLVED_CLIENT_PAGE_REGISTRY_ID,
      );

      expect(result?.code).toContain(path.basename(pageFile));
    } finally {
      await vite.close();
      hmrServer.close();
      fs.rmSync(appRoot, { recursive: true, force: true });
    }
  });
});

describe("dev server config: HMR websocket attachment", () => {
  it("attaches the websocket to the app server through server.ws, with no deprecated server.hmr keys", async () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-dev-ws-"));
    const hmrServer = createNodeServer();
    const config = await createWebConnectorViteConfig({
      appRoot,
      appSrcRoot: path.join(appRoot, "src"),
      webRoot: WEB_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      hmrServer,
      handlePageHotUpdate: async () => false,
      leadingPlugins: [],
    });

    const messages: string[] = [];
    const logger = createLogger("info");
    for (const level of ["info", "warn", "warnOnce", "error"] as const) {
      logger[level] = (message: string) => {
        messages.push(message);
      };
    }

    let vite: ViteDevServer | undefined;
    try {
      const hmr = config.server?.hmr;
      expect(typeof hmr === "object" ? Object.keys(hmr) : []).toEqual([]);
      expect(config.server?.ws).toMatchObject({ server: hmrServer });

      vite = await createServer({
        ...config,
        configFile: false,
        customLogger: logger,
        optimizeDeps: { ...config.optimizeDeps, noDiscovery: true, include: [] },
        server: { ...config.server, watch: null },
      });

      expect(messages.filter((message) => message.includes("deprecated"))).toEqual([]);
    } finally {
      await vite?.close();
      hmrServer.close();
      fs.rmSync(appRoot, { recursive: true, force: true });
    }
  });
});

describe("siteAllowedHosts", () => {
  it("allows nothing extra for a single-site app", () => {
    expect(siteAllowedHosts(undefined)).toEqual({});
  });

  it("allows every fixed site hostname", () => {
    expect(
      siteAllowedHosts({
        landing: { hosts: ["landing.test"] },
        client: { hosts: ["client.test"] },
      }),
    ).toEqual({ allowedHosts: ["landing.test", "client.test"] });
  });

  it("allows any host when a site is dynamic", () => {
    expect(siteAllowedHosts({ tenants: { dynamic: true } })).toEqual({ allowedHosts: true });
  });
});
