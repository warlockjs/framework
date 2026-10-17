import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end: `bin/warlock.js` run from TypeScript source (no `esm/` build
 * beside it, this checkout's layout) boots a real app for `warlock inspect`.
 *
 * Two source-mode defects are pinned here, both reproduced against this exact
 * fixture before the fix:
 *
 * 1. On Node 22.15 every booting command (`doctor`, `inspect`, `mcp`,
 *    `routes`) died in `bootstrap()` with `TypeError: t is not a function`
 *    from `dayjs.extend`. The bin registered its TypeScript `load` hook in the
 *    main thread, and an in-thread `load` hook makes Node hand a CommonJS
 *    package (`@mongez/time-wizard`) the empty, not-yet-run `exports` of a
 *    file an ES module also imports (`dayjs/plugin/utc.js`, imported by the
 *    scheduler). Node 26.3 does not show it, so this half only goes red on the
 *    affected Node lines.
 * 2. On every Node version, a bare subpath of a package consumed as source
 *    (`@warlock.js/core/net`) failed with `ERR_UNSUPPORTED_DIR_IMPORT`, because
 *    core has no `exports` map in source form. The fixture's route module
 *    imports it, so `inspect` loading that module proves the fallback.
 *
 * The fixture links `@warlock.js/*` from this repository into its own
 * `node_modules` — the way an app consumes these packages as source — and
 * lives outside the repository so nothing above it can resolve for it.
 */

const CORE_ROOT = path.resolve(__dirname, "../../..");
const PACKAGES_ROOT = path.resolve(CORE_ROOT, "..");
const WARLOCK_BIN = path.join(CORE_ROOT, "bin", "warlock.js");

/** Cold compile of the CLI graph from source is CPU-bound; see add-command-process-exit.test.ts. */
const CHILD_TIMEOUT_MS = 180_000;

let fixtureDir: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(os.tmpdir(), "warlock-source-cli-"));

  await writeFile(
    path.join(fixtureDir, "package.json"),
    JSON.stringify({ name: "source-cli-fixture", private: true, type: "module" }, null, 2),
  );
  await writeFile(
    path.join(fixtureDir, "warlock.config.ts"),
    'import { defineConfig } from "@warlock.js/core";\n\nexport default defineConfig({});\n',
  );

  await mkdir(path.join(fixtureDir, "src", "app", "ping"), { recursive: true });
  await writeFile(
    path.join(fixtureDir, "src", "app", "ping", "routes.ts"),
    [
      'import { router } from "@warlock.js/core";',
      'import { isPrivateOrReservedIp } from "@warlock.js/core/net";',
      "",
      'router.get("/ping", () => ({ loopbackIsPrivate: isPrivateOrReservedIp("127.0.0.1") }));',
      "",
    ].join("\n"),
  );

  const scope = path.join(fixtureDir, "node_modules", "@warlock.js");
  await mkdir(scope, { recursive: true });

  for (const name of ["core", "cache", "logger"]) {
    await symlink(path.join(PACKAGES_ROOT, name), path.join(scope, name), "dir");
  }
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WARLOCK_BIN, ...args], {
      cwd: fixtureDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "development" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    const timer = setTimeout(() => child.kill("SIGKILL"), CHILD_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("bin/warlock.js from source boots an app", () => {
  it(
    "warlock inspect --json boots the app and reports its routes",
    async () => {
      const { code, stdout, stderr } = await runCli(["inspect", "--json"]);

      // `inspect` prints a start-up failure on either stream; check both so a
      // regression names its cause instead of only failing on the exit code.
      const output = `${stdout}\n${stderr}`;

      expect(output).not.toContain("is not a function");
      expect(output).not.toContain("ERR_UNSUPPORTED_DIR_IMPORT");
      expect(code).toBe(0);

      const report = JSON.parse(stdout) as { routes: { method: string; path: string }[] };

      expect(report.routes).toContainEqual(
        expect.objectContaining({ method: "GET", path: "/ping" }),
      );
    },
    CHILD_TIMEOUT_MS + 5_000,
  );
});
