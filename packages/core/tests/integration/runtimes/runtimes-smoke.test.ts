import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Bun and Deno smoke, run on the real runtimes.
 *
 * Per runtime it proves two things:
 *
 * 1. `warlock dev` is refused with the Node-only message and exit code 1,
 *    before the CLI loads anything (`bin/warlock.js`).
 * 2. Core's HTTP stack — Fastify, the framework plugins including the
 *    public-folder static server, and the router — boots from source on that
 *    runtime and answers a JSON route, a POST body and a static file
 *    (`fixtures/serve-on-runtime.ts`).
 *
 * Starting a `warlock build` output on Bun and Deno is covered end to end by
 * the runtimes CI workflow; this spec is the quick, local half.
 *
 * A runtime that is not installed skips its block, and the block's title says
 * how to enable it. Binaries are found through `WARLOCK_BUN_BIN` /
 * `WARLOCK_DENO_BIN`, then `PATH`, then the official installers' default
 * locations (`~/.bun/bin`, `~/.deno/bin`).
 */

const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const warlockBin = path.join(coreRoot, "bin", "warlock.js");
const serveFixture = path.join(
  "tests",
  "integration",
  "runtimes",
  "fixtures",
  "serve-on-runtime.ts",
);

const BOOT_TIMEOUT_MS = 90_000;

function findBinary(name: "bun" | "deno", envKey: string): string | undefined {
  const fromEnv = process.env[envKey];

  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);

    if (directory && existsSync(candidate)) {
      return candidate;
    }
  }

  const installerDefault = path.join(homedir(), `.${name}`, "bin", name);

  return existsSync(installerDefault) ? installerDefault : undefined;
}

type RuntimeCase = {
  name: "bun" | "deno";
  label: string;
  binary: string | undefined;
  envKey: string;
  /** Arguments that run a script: `bun <script>`, `deno run -A <script>`. */
  runArgs: string[];
  /** Extra arguments for TypeScript source with extensionless relative imports. */
  sourceArgs: string[];
};

const runtimes: RuntimeCase[] = [
  {
    name: "bun",
    label: "Bun",
    binary: findBinary("bun", "WARLOCK_BUN_BIN"),
    envKey: "WARLOCK_BUN_BIN",
    runArgs: [],
    sourceArgs: [],
  },
  {
    name: "deno",
    label: "Deno",
    binary: findBinary("deno", "WARLOCK_DENO_BIN"),
    envKey: "WARLOCK_DENO_BIN",
    runArgs: ["run", "-A"],
    // Core's sources import siblings without extensions, which Deno resolves
    // only with --sloppy-imports. The built output never needs it.
    sourceArgs: ["--sloppy-imports"],
  },
];

/** Start the HTTP fixture and resolve with its port once it prints it. */
function serveOnRuntime(runtime: RuntimeCase, binary: string, publicRoot: string) {
  const child = spawn(
    binary,
    [...runtime.runArgs, ...runtime.sourceArgs, serveFixture, publicRoot],
    {
      cwd: coreRoot,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";

  const port = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${runtime.name} did not report a port in time.\n${output}`));
    }, BOOT_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();

      const match = /\{"port":(\d+)\}/.exec(output);

      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${runtime.name} exited with ${code} before serving.\n${output}`));
    });
  });

  const stop = () => {
    return new Promise<number | null>((resolve) => {
      if (child.exitCode !== null) {
        resolve(child.exitCode);
        return;
      }

      const killTimer = setTimeout(() => child.kill("SIGKILL"), 10_000);

      child.once("exit", (code) => {
        clearTimeout(killTimer);
        resolve(code);
      });
      child.kill("SIGTERM");
    });
  };

  return { port, stop };
}

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "warlock-runtimes-"));
  writeFileSync(path.join(workspace, "hello.txt"), "static ok\n");
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

for (const runtime of runtimes) {
  const title = runtime.binary
    ? `${runtime.label} runtime smoke (${runtime.binary})`
    : `${runtime.label} runtime smoke — SKIPPED: ${runtime.name} binary not found (install it or set ${runtime.envKey})`;

  describe.skipIf(!runtime.binary)(title, () => {
    const binary = runtime.binary ?? runtime.name;

    it(
      "refuses `warlock dev` with the Node-only message",
      () => {
        const result = spawnSync(binary, [...runtime.runArgs, warlockBin, "dev"], {
          cwd: workspace,
          encoding: "utf8",
          timeout: BOOT_TIMEOUT_MS,
        });

        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain(
          `warlock dev runs on Node.js only — this process is ${runtime.label} `,
        );
        expect(result.stderr).toContain("npx warlock dev");
      },
      BOOT_TIMEOUT_MS,
    );

    it(
      "serves a JSON route, a POST body and a public file through core's HTTP stack",
      async () => {
        const server = serveOnRuntime(runtime, binary, workspace);

        try {
          const port = await server.port;
          const base = `http://127.0.0.1:${port}`;

          const runtimeResponse = await fetch(`${base}/runtime`);
          expect(runtimeResponse.status).toBe(200);
          expect(await runtimeResponse.json()).toEqual({ runtime: runtime.name });

          const echoResponse = await fetch(`${base}/echo`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "warlock" }),
          });
          expect(echoResponse.status).toBe(200);
          expect(await echoResponse.json()).toEqual({ name: "warlock", runtime: runtime.name });

          const staticResponse = await fetch(`${base}/public/hello.txt`);
          expect(staticResponse.status).toBe(200);
          expect(await staticResponse.text()).toBe("static ok\n");
        } finally {
          await server.stop();
        }
      },
      BOOT_TIMEOUT_MS * 2,
    );
  });
}
