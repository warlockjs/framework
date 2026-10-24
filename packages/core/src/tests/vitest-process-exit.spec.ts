import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const fixture = fileURLToPath(new URL("../../tests/fixtures/vitest-exit-app", import.meta.url));

// A bound well above a healthy run (about ten seconds on a busy host) and well
// below the point where a leaked handle would only be reported after Vitest's
// own close timeout.
const EXIT_BOUND_MS = 60_000;

type Run = { code: number | null; output: string; elapsed: number; killed: boolean };

/**
 * Run the fixture app's real Vitest project layout (a plain unit project and an
 * integration project with the global-setup HTTP server, the Warlock runner and
 * `setupTest()`), exactly as an app's `vitest run` does.
 */
function runFixture(lifetime: "file" | "worker"): Promise<Run> {
  const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
  );

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [vitest, "run", "--reporter=default"], {
      cwd: fixture,
      env: { ...environment, NODE_ENV: "test", EXIT_APP_LIFETIME: lifetime },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, EXIT_BOUND_MS);

    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, elapsed: Date.now() - started, killed });
    });
  });
}

describe("vitest process exit", () => {
  it.each(["file", "worker"] as const)(
    "exits on its own after a green run with %s lifetime",
    async (lifetime) => {
      const run = await runFixture(lifetime);

      expect(run.output).toContain("3 passed");
      expect(run.output).toContain("[test-server] HTTP test server stopped");
      // Vitest prints these only when something still holds the process open
      // and its own close timeout had to give up.
      expect(run.output).not.toMatch(/prevents|close timed out/);
      expect(run.killed).toBe(false);
      expect(run.code).toBe(0);
      expect(run.elapsed).toBeLessThan(EXIT_BOUND_MS);
    },
    EXIT_BOUND_MS + 15_000,
  );
});
