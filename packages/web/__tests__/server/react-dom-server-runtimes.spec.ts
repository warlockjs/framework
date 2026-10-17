import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Streaming SSR on Bun and Deno, run on the real runtimes.
 *
 * Each runtime executes `fixtures/stream-render-on-runtime.mjs`, which streams
 * a React tree through `loadStreamingReactDomServer()` — the loader the page
 * renderer uses — and prints the HTML. The control case shows the module each
 * runtime selects for a bare `react-dom/server` import has no
 * `renderToPipeableStream`, which is why the loader exists.
 *
 * A runtime that is not installed skips its block, and the block's title says
 * how to enable it. Binaries are found through `WARLOCK_BUN_BIN` /
 * `WARLOCK_DENO_BIN`, then `PATH`, then the official installers' default
 * locations (`~/.bun/bin`, `~/.deno/bin`).
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join("__tests__", "server", "fixtures", "stream-render-on-runtime.mjs");

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
  binary: string | undefined;
  /** Arguments placed before the script path. */
  prefix: string[];
  envKey: string;
};

const runtimes: RuntimeCase[] = [
  {
    name: "bun",
    binary: findBinary("bun", "WARLOCK_BUN_BIN"),
    prefix: [],
    envKey: "WARLOCK_BUN_BIN",
  },
  {
    name: "deno",
    binary: findBinary("deno", "WARLOCK_DENO_BIN"),
    prefix: ["run", "-A"],
    envKey: "WARLOCK_DENO_BIN",
  },
];

function runFixture(runtime: RuntimeCase, binary: string, extra: string[] = []) {
  const result = spawnSync(binary, [...runtime.prefix, fixture, ...extra], {
    cwd: packageRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NODE_ENV: "production" },
  });

  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);

  return JSON.parse(result.stdout) as Record<string, unknown>;
}

for (const runtime of runtimes) {
  const title = runtime.binary
    ? `streaming SSR on ${runtime.name} (${runtime.binary})`
    : `streaming SSR on ${runtime.name} — SKIPPED: ${runtime.name} binary not found (install it or set ${runtime.envKey})`;

  describe.skipIf(!runtime.binary)(title, () => {
    const binary = runtime.binary ?? runtime.name;

    it("selects a react-dom/server build without renderToPipeableStream for a bare import", () => {
      expect(runFixture(runtime, binary, ["--condition-selected"])).toEqual({
        hasRenderToPipeableStream: false,
      });
    });

    it("streams HTML through loadStreamingReactDomServer()", () => {
      expect(runFixture(runtime, binary)).toEqual({ html: '<p id="marker">streamed</p>' });
    });
  });
}
