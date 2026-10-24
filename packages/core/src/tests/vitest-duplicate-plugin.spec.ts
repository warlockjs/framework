import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const fixture = fileURLToPath(new URL("../../tests/fixtures/vitest-plugin-app", import.meta.url));
const RUN_BOUND_MS = 60_000;

/**
 * Run the fixture with a real Vitest 5. Its config lists `lowerStage3Decorators()`
 * in the root config and again in two inline projects, the layout that makes
 * Vitest 5 print `applies the same plugin multiple times`.
 */
function runFixture(): Promise<{ code: number | null; output: string }> {
  const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
  );

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vitest, "run", "--reporter=default"], {
      cwd: fixture,
      env: { ...environment, NODE_ENV: "test", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_BOUND_MS);

    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe("lowerStage3Decorators under Vitest 5 inline projects", () => {
  it(
    "is not reported as a plugin applied multiple times",
    async () => {
      const run = await runFixture();

      expect(run.output).toContain("2 passed");
      expect(run.output).not.toMatch(/applies the same plugin multiple times/);
      expect(run.code).toBe(0);
    },
    RUN_BOUND_MS + 15_000,
  );
});
