import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  SINGLE_BUNDLE_MARKERS,
  SINGLE_BUNDLE_ROUTE,
  writeSingleBundleApp,
} from "./single-bundle-app";
import { workspace } from "./two-site-app";

/**
 * `build.singleBundle` + the web connector, end to end.
 *
 * Builds a small web app (layout, two pages, a page that lazy-loads a
 * component, a server route, one dependency) with the desktop recipe:
 * `singleBundle: true`, `chunks: "single"`, `precompress: false`. Then it
 * copies `dist/` to a folder with no `node_modules` anywhere above it and boots
 * `node app.js` from there.
 *
 * `warlock build` from a source checkout needs core's compiled
 * route-registration child (`esm/production/route-registration-child.mjs`),
 * which only exists after a package build, so the test skips without it.
 */
const child = join(workspace, "packages/core/esm/production/route-registration-child.mjs");
const warlock = join(workspace, "packages/core/bin/warlock.js");

const directories: string[] = [];
const processes: ChildProcess[] = [];

afterAll(async () => {
  for (const running of processes) {
    if (running.exitCode === null && running.pid !== undefined) running.kill("SIGTERM");
  }

  for (const directory of directories) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporary(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));

  directories.push(directory);

  return directory;
}

function run(
  command: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const running = spawn(process.execPath, command, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => running.kill("SIGKILL"), timeoutMs);

    running.stdout.on("data", (chunk) => (output += chunk));
    running.stderr.on("data", (chunk) => (output += chunk));
    running.on("error", reject);
    running.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      server.close(() => resolve(port));
    });
  });
}

async function listFiles(directory: string): Promise<string[]> {
  const found: string[] = [];

  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);

      if (entry.isDirectory()) await walk(full);
      else found.push(relative(directory, full).split("\\").join("/"));
    }
  };

  await walk(directory);

  return found.sort();
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const response = await fetch(url);

      if (response.status === 200) return;
    } catch {
      // not listening yet
    }

    if (Date.now() > deadline) throw new Error(`${url} did not answer in ${timeoutMs}ms`);

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe.skipIf(!existsSync(child))("singleBundle with the web connector", () => {
  it("builds one server file plus client/, and boots from a copy with no node_modules", async () => {
    const app = await temporary("warlock-single-bundle-app-");

    await writeSingleBundleApp(app, {
      build: "{ singleBundle: true, minify: false }",
      web: ', build: { chunks: "single", precompress: false }',
    });

    const built = await run([warlock, "build"], app, 540_000);

    expect(built.code, built.output.slice(-4000)).toBe(0);
    expect(built.output).toMatch(/dist: \d+ files?, /);

    const dist = join(app, "dist");
    const files = await listFiles(dist);
    const clientAssets = files.filter((file) => file.startsWith("client/assets/"));

    // Server: one bundle (and its map), no chunks, no framework modules left to resolve.
    expect(files).toContain("app.js");
    expect(files.filter((file) => /^[^/]+\.js$/.test(file))).toEqual(["app.js"]);

    // Client: one script, no precompressed copies, at most one stylesheet.
    expect(clientAssets.filter((file) => file.endsWith(".js"))).toHaveLength(1);
    expect(clientAssets.filter((file) => file.endsWith(".css")).length).toBeLessThanOrEqual(1);
    expect(clientAssets.filter((file) => /\.(br|gz)$/.test(file))).toEqual([]);

    // The production server never carries Vite.
    const bundle = await readFile(join(dist, "app.js"), "utf8");

    expect(bundle).not.toMatch(/node_modules\/\.pnpm\/vite@/);
    expect(bundle).not.toMatch(/from "vite"/);

    // Only native packages may sit in dist/node_modules.
    for (const file of files.filter((file) => file.startsWith("node_modules/"))) {
      expect(file).toMatch(/^node_modules\/(oxc-parser|@oxc-parser|@oxc-project)\//);
    }

    const standalone = await temporary("warlock-standalone-");

    await cp(dist, standalone, { recursive: true });
    expect(existsSync(join(standalone, "..", "node_modules"))).toBe(false);

    const port = await freePort();
    const server = spawn(process.execPath, ["app.js"], {
      cwd: standalone,
      env: { ...process.env, NODE_ENV: "", HTTP_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";

    processes.push(server);
    server.stdout.on("data", (chunk) => (log += chunk));
    server.stderr.on("data", (chunk) => (log += chunk));

    try {
      await waitFor(`http://127.0.0.1:${port}${SINGLE_BUNDLE_ROUTE}`, 60_000);

      const base = `http://127.0.0.1:${port}`;
      const home = await (await fetch(`${base}/`)).text();
      const about = await (await fetch(`${base}/about`)).text();
      const lazy = await (await fetch(`${base}/lazy`)).text();
      const api = await (await fetch(`${base}${SINGLE_BUNDLE_ROUTE}`)).json();

      expect(home).toContain(SINGLE_BUNDLE_MARKERS.home);
      expect(about).toContain(SINGLE_BUNDLE_MARKERS.about);
      expect(lazy).toContain(SINGLE_BUNDLE_MARKERS.lazy);
      expect(api).toMatchObject({ ok: true });

      const script = clientAssets.find((file) => file.endsWith(".js"))!;
      const asset = await fetch(`${base}/${script.replace("client/", "")}`);

      expect(asset.status).toBe(200);
      expect((await stat(join(standalone, script))).size).toBeGreaterThan(0);
    } catch (error) {
      throw new Error(`${String(error)}\n--- server log ---\n${log.slice(-3000)}`);
    } finally {
      server.kill("SIGTERM");
    }
  }, 600_000);
});
