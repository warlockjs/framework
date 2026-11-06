/**
 * `warlock dev`'s Vite server must not share `node_modules/.vite` with the
 * other Vite processes of the same app.
 *
 * A vitest run in the app re-optimizes dependencies into Vite's default cache
 * directory; when that is also the dev server's directory, the run wipes the
 * optimized deps the dev server is serving and every SSR page answers 500 until
 * restart. These specs read the config the connector really hands to
 * `createServer`.
 */
import { createServer as createNodeServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createWebConnectorViteConfig, webDevServerCacheDir } from "./dev-server-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..", "..");

async function devConfig(appRoot: string) {
  return createWebConnectorViteConfig({
    appRoot,
    appSrcRoot: path.join(appRoot, "src"),
    webRoot: WEB_ROOT,
    workspaceRoot: path.resolve(WEB_ROOT, ".."),
    hmrServer: createNodeServer(),
    handlePageHotUpdate: async () => false,
    leadingPlugins: [],
  });
}

describe("dev server Vite config — its own cacheDir", () => {
  it("uses <appRoot>/node_modules/.vite/warlock-dev-<hash of the app root>", async () => {
    const appRoot = path.resolve(WEB_ROOT, "..", "some-app");
    const config = await devConfig(appRoot);

    expect(path.dirname(config.cacheDir as string)).toBe(path.join(appRoot, "node_modules", ".vite"));
    expect(path.basename(config.cacheDir as string)).toMatch(/^warlock-dev-[0-9a-f]{8}$/);
  });

  it("is stable for one project and differs between project roots", () => {
    const first = path.resolve(WEB_ROOT, "..", "app-one");
    const second = path.resolve(WEB_ROOT, "..", "app-two");

    expect(webDevServerCacheDir(first)).toBe(webDevServerCacheDir(first));
    expect(path.basename(webDevServerCacheDir(first))).not.toBe(
      path.basename(webDevServerCacheDir(second)),
    );
  });

  it("lets an explicit cacheDir win, resolving a relative one against the app root", async () => {
    const appRoot = path.resolve(WEB_ROOT, "..", "some-app");

    expect(webDevServerCacheDir(appRoot, "/tmp/vite-cache")).toBe(path.resolve("/tmp/vite-cache"));
    expect(webDevServerCacheDir(appRoot, ".cache/vite")).toBe(path.join(appRoot, ".cache", "vite"));
    expect(
      (await createWebConnectorViteConfig({
        appRoot,
        appSrcRoot: path.join(appRoot, "src"),
        webRoot: WEB_ROOT,
        workspaceRoot: path.resolve(WEB_ROOT, ".."),
        cacheDir: ".cache/vite",
        hmrServer: createNodeServer(),
        handlePageHotUpdate: async () => false,
        leadingPlugins: [],
      })).cacheDir,
    ).toBe(path.join(appRoot, ".cache", "vite"));
  });

  it("is never Vite's shared default directory, which vitest and other Vite processes use", async () => {
    const appRoot = path.resolve(WEB_ROOT, "..", "some-app");
    const config = await devConfig(appRoot);
    const sharedDefault = path.join(appRoot, "node_modules", ".vite");

    expect(config.cacheDir).not.toBe(sharedDefault);
    // Nested under it, so one `.vite` stays the only artefact in node_modules,
    // but a different directory: neither side can wipe the other's files.
    expect(path.relative(sharedDefault, config.cacheDir as string)).toMatch(/^warlock-dev-[0-9a-f]{8}$/);
  });

  it("resolves a relative appRoot to an absolute directory", () => {
    expect(path.isAbsolute(webDevServerCacheDir("."))).toBe(true);
  });
});
