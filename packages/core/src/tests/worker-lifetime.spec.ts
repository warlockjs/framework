import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const source = fileURLToPath(new URL("../", import.meta.url));
const specifier = (relative: string) => JSON.stringify(path.join(source, relative));

// A real forks run proves the runner's cleanup ownership and module-graph
// lifetime. Slow application collaborators are mocked; no server or DB starts.
describe("worker runtime across Vitest files", () => {
  it("boots at most maxWorkers times and closes every runtime before the forks exit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "warlock-worker-lifetime-"));
    try {
      const manifest = require.resolve("vitest/package.json");
      await symlink(
        path.dirname(path.dirname(manifest)),
        path.join(root, "node_modules"),
        "junction",
      );
      const ledger = path.join(root, "lifecycle.jsonl");
      await writeFile(ledger, "");
      await writeFile(
        path.join(root, "vitest.config.mjs"),
        `export default {
        server: { fs: { allow: [${JSON.stringify(root)}, ${JSON.stringify(source)}] } },
        test: {
          environment: "node", pool: "forks", isolate: false, maxWorkers: 2,
          include: ["file-*.test.ts"], setupFiles: ["./setup.ts"], runner: "./runner.ts",
          env: { NODE_ENV: "test", TEST_BOOTSTRAP_LEDGER: ${JSON.stringify(ledger)} }
        }
      };`,
      );
      await writeFile(
        path.join(root, "runner.ts"),
        `
        import { TestRunner } from "vitest";
        import { configureTestWorker } from ${specifier("tests/test-runtime-scope.ts")};
        export default class extends TestRunner {
          constructor(config) {
            super(config);
            configureTestWorker({ pool: this.pool, watch: config.watch, isolate: config.isolate },
              (cleanup) => this.onCleanupWorkerContext?.(cleanup));
          }
        }
      `,
      );
      await writeFile(
        path.join(root, "setup.ts"),
        `
        import { afterAll, vi } from "vitest";
        vi.mock(${specifier("application/application.ts")}, () => ({ Application: { setEnvironment() {}, runShutdownHooks() {} } }));
        vi.mock(${specifier("bootstrap.ts")}, () => ({ bootstrap: async () => {
          const { appendFile } = await import("node:fs/promises");
          await appendFile(process.env.TEST_BOOTSTRAP_LEDGER, JSON.stringify({ type: "boot", pid: process.pid }) + "\\n");
        } }));
        vi.mock(${specifier("warlock-config/warlock-config.manager.ts")}, () => ({ warlockConfigManager: { async load() {} } }));
        vi.mock(${specifier("config/index.ts")}, () => ({ config: { get: () => ({ lifetime: "worker", connectors: false }) } }));
        vi.mock(${specifier("config/load-config-files.ts")}, () => ({ async loadConfigFiles() {} }));
        vi.mock(${specifier("tests/load-unit-config.ts")}, () => ({ async loadUnitConfig() {} }));
        vi.mock(${specifier("dev-server/files-orchestrator.ts")}, () => ({ filesOrchestrator: { async init() {} } }));
        vi.mock(${specifier("tests/fakes/test-fakes.ts")}, () => ({ async installTestFakes() {}, async restoreTestFakes() {} }));
        vi.mock(${specifier("connectors/index.ts")}, () => ({ connectorsManager: { async shutdown() {
          const { appendFile } = await import("node:fs/promises");
          await appendFile(process.env.TEST_BOOTSTRAP_LEDGER, JSON.stringify({ type: "close", pid: process.pid }) + "\\n");
        } } }));
        import { setupTest, teardownTest } from ${specifier("tests/vitest-setup.ts")};
        await setupTest({ importModule: (file) => import(file) });
        afterAll(teardownTest);
      `,
      );
      for (let index = 0; index < 6; index += 1) {
        await writeFile(
          path.join(root, `file-${index}.test.ts`),
          `
          import { expect, it } from "vitest";
          import { getTestRuntimeStats } from ${specifier("tests/test-runtime-scope.ts")};
          it("reuses the fork runtime", () => expect(getTestRuntimeStats().bootstraps).toBe(1));
        `,
        );
      }
      const child = spawn(
        process.execPath,
        [path.join(path.dirname(manifest), "vitest.mjs"), "run", "--config", "vitest.config.mjs"],
        {
          cwd: root,
          env: { ...process.env, NODE_ENV: "test" },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        },
      );
      const pid = child.pid;
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      const timeout = setTimeout(() => {
        // Stop only the process/group created by this spec.
        if (pid !== undefined) {
          if (process.platform === "win32") child.kill();
          else {
            try {
              process.kill(-pid, "SIGTERM");
            } catch (error) {
              if (
                !(
                  typeof error === "object" &&
                  error !== null &&
                  "code" in error &&
                  error.code === "ESRCH"
                )
              )
                throw error;
            }
          }
        }
      }, 60000);
      let code: number | null;
      try {
        code = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        });
      } finally {
        clearTimeout(timeout);
      }
      expect(code, output).toBe(0);
      const events: { type: string; pid: number }[] = (await readFile(ledger, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const boots = events
        .filter((event) => event.type === "boot")
        .map((event) => event.pid)
        .sort();
      const closes = events
        .filter((event) => event.type === "close")
        .map((event) => event.pid)
        .sort();
      expect(boots.length).toBeGreaterThan(0);
      expect(boots.length).toBeLessThanOrEqual(2);
      expect(new Set(boots).size).toBe(boots.length);
      expect(closes).toEqual(boots);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90000);
});
