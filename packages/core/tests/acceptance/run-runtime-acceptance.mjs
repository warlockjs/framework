#!/usr/bin/env node
/**
 * Runtime acceptance: build a Warlock app with Node, then start the built
 * output on Node, Bun and Deno and smoke-test it over real HTTP.
 *
 * `warlock dev` and `warlock build` are Node commands; `warlock start` and the
 * built entry (`dist/app.js`) are supported on Node, Bun and Deno. This run is
 * the proof for the second half, against the artifact a user installs:
 *
 *   1. build every @warlock.js/* member the app needs with pkgist (one fresh
 *      process each, no publish, no git) and pack each into a tarball;
 *   2. copy `runtime-app/` to a temp directory OUTSIDE this repository (so no
 *      parent node_modules or workspace manifest can resolve anything for it),
 *      install it with pnpm from those tarballs, and run `warlock build` on Node;
 *   3. for each runtime, start the build twice — directly (`bun dist/app.js`,
 *      `deno run -A dist/app.js`, `node dist/app.js`) and through the CLI
 *      (`<runtime> node_modules/@warlock.js/core/bin/warlock.js start`) — on a
 *      free port, and require: the server-rendered page, a JSON API route, a
 *      file-cache round trip, a POST body, a public file, a hashed client asset,
 *      `/health`, a 404, a clean SIGTERM shutdown and a released port.
 *
 * Usage:
 *   node packages/core/tests/acceptance/run-runtime-acceptance.mjs
 *   node packages/core/tests/acceptance/run-runtime-acceptance.mjs --runtimes=bun
 *   node packages/core/tests/acceptance/run-runtime-acceptance.mjs --runtimes=node,bun,deno --evidence=out.json
 *
 * `--runtimes` lists the runtimes that MUST pass; a listed runtime whose binary
 * is missing fails the run. Without it, Node runs and Bun/Deno run when their
 * binaries are found (and are reported as skipped otherwise). Binaries come
 * from WARLOCK_BUN_BIN / WARLOCK_DENO_BIN, then PATH, then ~/.bun/bin and
 * ~/.deno/bin. `--reuse-builds` packs whatever pkgist built last instead of
 * rebuilding (local iteration only: it does not test the current source).
 * `--keep` leaves the temp app in place.
 *
 * Prerequisites: `pnpm install` at the root and `npm ci` in tools/release.
 */
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const TAG = "[runtime-acceptance]";
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(here, "runtime-app");
const coreDirectory = path.resolve(here, "../..");
const packagesDirectory = path.resolve(coreDirectory, "..");
const repositoryRoot = path.resolve(packagesDirectory, "..");
const releaseDirectory = path.join(repositoryRoot, "tools", "release");
const buildsDirectory = path.join(releaseDirectory, "builds");

const PNPM = "pnpm@11.24.0";
const HOST = "127.0.0.1";
const BOOT_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 15_000;

/** Inherited values that would beat the fixture's own .env. */
const SCRUBBED_ENV = [
  "NODE_ENV",
  "HTTP_PORT",
  "HTTP_HOST",
  "APP_NAME",
  "BASE_URL",
  "WARLOCK_ROLES",
  "WARLOCK_SITES",
  "WARLOCK_DEV_WORKER",
  "WARLOCK_BOOT_SIGNAL",
  "NODE_OPTIONS",
];

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const flag = (name) => args.includes(`--${name}`);

const requestedRuntimes = option("runtimes")?.split(",").filter(Boolean);
const evidencePath = option("evidence");
const reuseBuilds = flag("reuse-builds");
const keepApp = flag("keep");

const coreVersion = readJson(path.join(coreDirectory, "package.json")).version;

const liveChildren = new Set();

function log(message) {
  console.log(`${TAG} ${message}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function cleanEnv(extra = {}) {
  const env = { ...process.env };

  for (const key of SCRUBBED_ENV) delete env[key];

  return { ...env, NO_COLOR: "1", ...extra };
}

/** Run to completion; reject on a non-zero exit with the command named. */
function run(command, commandArgs, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, env: env ?? cleanEnv(), stdio: "inherit" });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
    });
  });
}

function findBinary(name, envKey) {
  const fromEnv = process.env[envKey];

  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);

    if (directory && existsSync(candidate)) return candidate;
  }

  const installerDefault = path.join(homedir(), `.${name}`, "bin", name);

  return existsSync(installerDefault) ? installerDefault : undefined;
}

// ─── the family the app needs ────────────────────────────────────────────────

/** `@warlock.js/<name>` → `packages/<dir>`, from the manifests themselves. */
function workspaceMembers() {
  const members = new Map();

  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    const manifestPath = path.join(packagesDirectory, entry.name, "package.json");

    if (!entry.isDirectory() || !existsSync(manifestPath)) continue;

    const manifest = readJson(manifestPath);

    if (typeof manifest.name === "string" && manifest.name.startsWith("@warlock.js/")) {
      members.set(manifest.name, { directory: entry.name, manifest });
    }
  }

  return members;
}

/** Every @warlock.js/* the fixture reaches through `dependencies`. */
function dependencyClosure(members) {
  const fixtureManifest = readJson(path.join(fixtureDirectory, "package.json"));
  const pending = Object.keys(fixtureManifest.dependencies).filter((name) =>
    name.startsWith("@warlock.js/"),
  );
  const closure = new Set();

  while (pending.length > 0) {
    const name = pending.pop();

    if (closure.has(name)) continue;

    const member = members.get(name);

    if (!member) throw new Error(`${name} is not a package in ${packagesDirectory}`);

    closure.add(name);

    for (const dependency of Object.keys(member.manifest.dependencies ?? {})) {
      if (dependency.startsWith("@warlock.js/")) pending.push(dependency);
    }
  }

  return [...closure].toSorted();
}

/** The overrides in runtime-app/pnpm-workspace.yaml must name exactly the closure. */
function assertOverridesMatch(closure) {
  const yaml = readFileSync(path.join(fixtureDirectory, "pnpm-workspace.yaml"), "utf8");
  const listed = [...yaml.matchAll(/^\s+"(@warlock\.js\/[a-z0-9-]+)":/gm)].map((match) => match[1]);

  const missing = closure.filter((name) => !listed.includes(name));
  const extra = listed.filter((name) => !closure.includes(name));

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `runtime-app/pnpm-workspace.yaml overrides drifted from the app's dependency closure — ` +
        `missing: [${missing.join(", ")}], not needed: [${extra.join(", ")}]`,
    );
  }
}

async function buildFamily(closure) {
  const pkgist = path.join(releaseDirectory, "node_modules", "@mongez", "pkgist", "esm", "cli.mjs");

  if (!existsSync(pkgist)) {
    throw new Error(
      `pkgist is not installed at ${pkgist} — run \`npm ci\` in tools/release first.`,
    );
  }

  for (const [index, name] of closure.entries()) {
    log(`building ${name}@${coreVersion} (${index + 1}/${closure.length})`);
    await run(
      process.execPath,
      [pkgist, "build", name, "--no-publish", "--no-git", "--bump", coreVersion],
      { cwd: releaseDirectory, env: cleanEnv({ CI: "1" }) },
    );
  }
}

async function packFamily(closure, vendorDirectory) {
  mkdirSync(vendorDirectory, { recursive: true });

  for (const name of closure) {
    const artifact = path.join(buildsDirectory, name, coreVersion);
    const shortName = name.slice("@warlock.js/".length);

    if (!existsSync(path.join(artifact, "package.json"))) {
      throw new Error(`no build for ${name}@${coreVersion} at ${artifact}`);
    }

    const before = new Set(readdirSync(vendorDirectory));

    await run("npm", ["pack", artifact, "--pack-destination", vendorDirectory, "--silent"]);

    const created = readdirSync(vendorDirectory).filter(
      (file) => file.endsWith(".tgz") && !before.has(file),
    );

    if (created.length !== 1) {
      throw new Error(`npm pack ${artifact} produced ${created.length} tarballs`);
    }

    renameSync(
      path.join(vendorDirectory, created[0]),
      path.join(vendorDirectory, `${shortName}.tgz`),
    );
  }
}

// ─── starting and probing ────────────────────────────────────────────────────

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen({ port: 0, host: HOST }, () => {
      const { port } = server.address();

      server.close(() => resolve(port));
    });
  });
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", () => resolve(false));
    server.listen({ port, host: HOST, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function startCommand(runtime, mode, appDirectory) {
  const entry = path.join("dist", "app.js");
  const cli = path.join(appDirectory, "node_modules", "@warlock.js", "core", "bin", "warlock.js");

  switch (runtime.name) {
    case "node":
      return mode === "direct"
        ? [runtime.binary, ["--enable-source-maps", entry]]
        : [runtime.binary, [cli, "start"]];
    case "bun":
      return mode === "direct" ? [runtime.binary, [entry]] : [runtime.binary, [cli, "start"]];
    case "deno":
      return mode === "direct"
        ? [runtime.binary, ["run", "-A", entry]]
        : [runtime.binary, ["run", "-A", cli, "start"]];
    default:
      throw new Error(`unknown runtime ${runtime.name}`);
  }
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
}

async function waitForHealth(base, child, output) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `the server exited (${child.exitCode ?? child.signalCode}) before serving:\n${output()}`,
      );
    }

    try {
      const response = await fetchWithTimeout(`${base}/health`);

      if (response.status === 200) return;
    } catch {
      // not listening yet
    }

    await delay(250);
  }

  throw new Error(`no 200 from /health within ${BOOT_TIMEOUT_MS}ms:\n${output()}`);
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ graceful: true, code: child.exitCode });
      return;
    }

    const timer = setTimeout(() => {
      killGroup(child, "SIGKILL");
      resolve({ graceful: false, code: null });
    }, STOP_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(timer);
      // Anything the server spawned (the CLI's child) must be gone too.
      killGroup(child, "SIGKILL");
      resolve({ graceful: true, code });
    });

    child.kill("SIGTERM");
  });
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // group already gone
  }
}

async function smoke(runtime, mode, appDirectory) {
  const port = await freePort();
  const base = `http://${HOST}:${port}`;
  const [command, commandArgs] = startCommand(runtime, mode, appDirectory);
  const display = `${path.basename(command)} ${commandArgs
    .map((arg) => (arg.startsWith(appDirectory) ? path.relative(appDirectory, arg) : arg))
    .join(" ")}`;

  log(`${runtime.name} ${runtime.version} — ${mode}: ${display} (port ${port})`);

  const child = spawn(command, commandArgs, {
    cwd: appDirectory,
    env: cleanEnv({ NODE_ENV: "production", HTTP_PORT: String(port), BASE_URL: base }),
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group, so the CLI's child can be reaped with it.
    detached: true,
  });

  liveChildren.add(child);

  let output = "";

  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const checks = [];
  const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });

  try {
    await waitForHealth(base, child, () => output);

    const page = await fetchWithTimeout(`${base}/`);
    const html = await page.text();
    check(
      "GET / (server-rendered page)",
      page.status === 200 &&
        html.includes("RUNTIME_PAGE_OK") &&
        html.includes(`id="runtime-name">${runtime.name}<`),
      `${page.status}`,
    );

    const api = await fetchWithTimeout(`${base}/api/runtime`);
    const apiBody = await api.json().catch(() => undefined);
    check(
      "GET /api/runtime",
      api.status === 200 &&
        apiBody?.runtime === runtime.name &&
        apiBody?.environment === "production",
      JSON.stringify(apiBody),
    );

    const cached = await fetchWithTimeout(`${base}/api/cache`);
    const cachedBody = await cached.json().catch(() => undefined);
    check(
      "GET /api/cache (file cache round trip)",
      cached.status === 200 &&
        typeof cachedBody?.stored === "string" &&
        cachedBody.stored === cachedBody.read,
      JSON.stringify(cachedBody),
    );

    const echo = await fetchWithTimeout(`${base}/api/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "warlock" }),
    });
    const echoBody = await echo.json().catch(() => undefined);
    check(
      "POST /api/echo (JSON body)",
      echo.status === 200 && echoBody?.name === "warlock" && echoBody?.runtime === runtime.name,
      JSON.stringify(echoBody),
    );

    const file = await fetchWithTimeout(`${base}/public/hello.txt`);
    const fileText = await file.text();
    check(
      "GET /public/hello.txt (static file)",
      file.status === 200 && fileText.trim() === "hello from a static file",
      `${file.status}`,
    );

    const assetName = readdirSync(path.join(appDirectory, "dist", "client", "assets")).find(
      (name) => name.endsWith(".js"),
    );
    const asset = await fetchWithTimeout(`${base}/assets/${assetName}`);
    await asset.arrayBuffer();
    check(
      `GET /assets/${assetName} (client bundle)`,
      asset.status === 200 && (asset.headers.get("content-type") ?? "").includes("javascript"),
      `${asset.status} ${asset.headers.get("content-type")}`,
    );

    const health = await fetchWithTimeout(`${base}/health`);
    const healthBody = await health.json().catch(() => undefined);
    check(
      "GET /health",
      health.status === 200 && healthBody?.status === "ok",
      JSON.stringify(healthBody),
    );

    const missing = await fetchWithTimeout(`${base}/runtime-acceptance-missing`);
    await missing.arrayBuffer();
    check("GET /runtime-acceptance-missing → 404", missing.status === 404, `${missing.status}`);

    if (mode === "cli") {
      check(
        "warlock start reported the boot",
        output.includes("production server started"),
        "ready banner on stdout",
      );
    }
  } catch (error) {
    check("boot and serve", false, error.message);
  } finally {
    const stopped = await stopServer(child);
    liveChildren.delete(child);

    check("SIGTERM shuts the server down", stopped.graceful, `exit ${stopped.code}`);
    check("port released after shutdown", await portIsFree(port), `port ${port}`);
  }

  const failed = checks.filter((entry) => !entry.ok);

  for (const entry of checks) {
    console.log(
      `  ${entry.ok ? "✔" : "✖"} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`,
    );
  }

  if (failed.length > 0) {
    console.log(`  --- server output (${runtime.name}, ${mode}) ---\n${output}`);
  }

  return { runtime: runtime.name, version: runtime.version, mode, command: display, checks };
}

function runtimeVersion(binary) {
  return new Promise((resolve) => {
    const child = spawn(binary, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let text = "";

    child.stdout.on("data", (chunk) => (text += chunk));
    child.on("close", () => {
      const match = /(\d+\.\d+\.\d+)/.exec(text);

      resolve(match ? match[1] : "unknown");
    });
    child.on("error", () => resolve("unknown"));
  });
}

async function resolveRuntimes() {
  const candidates = [
    { name: "node", binary: process.execPath },
    { name: "bun", binary: findBinary("bun", "WARLOCK_BUN_BIN") },
    { name: "deno", binary: findBinary("deno", "WARLOCK_DENO_BIN") },
  ];

  const selected = [];
  const skipped = [];

  for (const candidate of candidates) {
    const wanted = requestedRuntimes ? requestedRuntimes.includes(candidate.name) : true;

    if (!wanted) continue;

    if (!candidate.binary) {
      if (requestedRuntimes) {
        throw new Error(
          `--runtimes asks for ${candidate.name}, but no ${candidate.name} binary was found ` +
            `(set WARLOCK_${candidate.name.toUpperCase()}_BIN or put it on PATH)`,
        );
      }

      skipped.push(candidate.name);
      continue;
    }

    selected.push({ ...candidate, version: await runtimeVersion(candidate.binary) });
  }

  for (const name of requestedRuntimes ?? []) {
    if (!candidates.some((candidate) => candidate.name === name)) {
      throw new Error(`unknown runtime "${name}" (expected node, bun or deno)`);
    }
  }

  return { selected, skipped };
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const { selected, skipped } = await resolveRuntimes();

  log(`runtimes: ${selected.map((runtime) => `${runtime.name} ${runtime.version}`).join(", ")}`);

  if (skipped.length > 0) log(`skipped (binary not found): ${skipped.join(", ")}`);

  const members = workspaceMembers();
  const closure = dependencyClosure(members);

  assertOverridesMatch(closure);

  if (reuseBuilds) {
    log(
      "! --reuse-builds: packing existing pkgist builds; this run does not test the current source",
    );
  } else {
    await buildFamily(closure);
  }

  const workspace = mkdtempSync(path.join(tmpdir(), "warlock-runtime-acceptance-"));
  const appDirectory = path.join(workspace, "app");
  const results = [];
  let failure;

  try {
    cpSync(fixtureDirectory, appDirectory, {
      recursive: true,
      filter: (source) =>
        !/[\\/](node_modules|vendor|dist|\.warlock|storage)([\\/]|$)/.test(source),
    });

    log(`packing ${closure.length} members into ${appDirectory}/vendor`);
    await packFamily(closure, path.join(appDirectory, "vendor"));

    // Installed in development so pnpm keeps devDependencies; the build and
    // every start below run in production.
    log(`installing with ${PNPM}`);
    await run("npx", ["--yes", PNPM, "install", "--no-frozen-lockfile"], {
      cwd: appDirectory,
      env: cleanEnv({ NODE_ENV: "development", CI: "1" }),
    });

    log(`building with Node ${process.versions.node}`);
    await run(
      process.execPath,
      [
        path.join(appDirectory, "node_modules", "@warlock.js", "core", "bin", "warlock.js"),
        "build",
      ],
      { cwd: appDirectory, env: cleanEnv({ NODE_ENV: "production" }) },
    );

    for (const runtime of selected) {
      for (const mode of ["direct", "cli"]) {
        results.push(await smoke(runtime, mode, appDirectory));
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    if (keepApp) log(`kept the app at ${appDirectory}`);
    else rmSync(workspace, { recursive: true, force: true });
  }

  const failedRuns = results.filter((result) => result.checks.some((entry) => !entry.ok));

  if (evidencePath) {
    writeFileSync(
      evidencePath,
      `${JSON.stringify({ version: coreVersion, node: process.versions.node, skipped, results, error: failure?.message }, null, 2)}\n`,
    );
  }

  console.log("");
  for (const result of results) {
    const ok = result.checks.every((entry) => entry.ok);

    console.log(
      `${ok ? "✔" : "✖"} ${result.runtime} ${result.version} (${result.mode}): ${result.command}`,
    );
  }

  if (failure) throw failure;

  if (failedRuns.length > 0) {
    throw new Error(`${failedRuns.length} runtime start(s) failed their smoke checks`);
  }

  if (results.length === 0) throw new Error("no runtime was started");

  log(
    `ACCEPTED — the Node build starts and serves on ${selected.map((runtime) => runtime.name).join(", ")}`,
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of liveChildren) killGroup(child, "SIGKILL");
    process.exit(130);
  });
}

main().catch((error) => {
  for (const child of liveChildren) killGroup(child, "SIGKILL");
  console.error(`${TAG} FAILED: ${error.message}`);
  process.exit(1);
});
