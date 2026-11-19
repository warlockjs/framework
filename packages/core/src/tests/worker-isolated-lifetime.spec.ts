import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connectorsManagerSurvived, rememberConnectorsManager } from "./fresh-module-graph";
import { configureTestWorker, selectTestLifetime, testRuntimeScope } from "./test-runtime-scope";

const require = createRequire(import.meta.url);
const source = fileURLToPath(new URL("../", import.meta.url));
const specifier = (relative: string) => JSON.stringify(path.join(source, relative));

describe('tests.lifetime: "worker-isolated" selection', () => {
  it("accepts the value on a compatible worker and marks the scope for fresh modules", () => {
    configureTestWorker({ pool: "forks", watch: false, isolate: false }, () => undefined);

    expect(selectTestLifetime("worker-isolated")).toBe("worker");
    expect(testRuntimeScope().freshModules).toBe(true);
    expect(selectTestLifetime("worker")).toBe("worker");
    expect(testRuntimeScope().freshModules).toBe(false);
    expect(selectTestLifetime(undefined)).toBe("file");
    expect(testRuntimeScope().freshModules).toBe(false);
  });

  it("refuses the value when Vitest isolates files", () => {
    configureTestWorker({ pool: "forks", watch: false, isolate: true }, () => undefined);

    expect(() => selectTestLifetime("worker-isolated")).toThrow(/isolate: false/);
    configureTestWorker({ pool: "forks", watch: false, isolate: false }, () => undefined);
  });

  it("rejects unknown values and names the three valid ones", () => {
    expect(() => selectTestLifetime("shared")).toThrow(/"file", "worker" or "worker-isolated"/);
  });
});

describe("connectors manager survival check", () => {
  it("passes for the booted manager and fails for a re-evaluated one", () => {
    const booted = {};
    rememberConnectorsManager(booted);

    expect(connectorsManagerSurvived(booted)).toBe(true);
    expect(connectorsManagerSurvived({})).toBe(false);
    rememberConnectorsManager(undefined);
    expect(connectorsManagerSurvived({})).toBe(true);
  });
});

// A real forks run with isolate: false. The connector lives on a Symbol.for key
// of globalThis, the way the framework keeps the lifecycle registry; every file
// mocks, spies, stubs env and uses fake timers on the same application module.
describe("fresh module graph per file on one worker", () => {
  it("opens the connector once, and no file sees another file's mocks, spies, env, globals, timers or module cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "warlock-worker-isolated-"));
    try {
      const manifest = require.resolve("vitest/package.json");
      await symlink(
        path.dirname(path.dirname(manifest)),
        path.join(root, "node_modules"),
        "junction",
      );
      const ledger = path.join(root, "ledger.jsonl");
      await writeFile(ledger, "");
      await writeFile(
        path.join(root, "vitest.config.mjs"),
        `export default {
          server: { fs: { allow: [${JSON.stringify(root)}, ${JSON.stringify(source)}] } },
          test: {
            environment: "node", pool: "forks", isolate: false, maxWorkers: 1, fileParallelism: false,
            include: ["file-*.test.ts"], setupFiles: ["./setup.ts"],
            sequence: { shuffle: { files: true, tests: false }, seed: 7 },
            env: { LEDGER: ${JSON.stringify(ledger)} }
          }
        };`,
      );
      await writeFile(
        path.join(root, "service.ts"),
        `export const service = { name: "real", cache: new Map() };
export const readEnv = () => process.env.SPIKE_FLAG ?? "unset";`,
      );
      await writeFile(
        path.join(root, "setup.ts"),
        `import { appendFileSync } from "node:fs";
import { afterAll } from "vitest";
import { resetFileModuleGraph } from ${specifier("tests/fresh-module-graph.ts")};
const KEY = Symbol.for("spike:connector");
const host = globalThis;
await resetFileModuleGraph();
if (!host[KEY]) {
  host[KEY] = { pid: process.pid };
  appendFileSync(process.env.LEDGER, JSON.stringify({ type: "connect", pid: process.pid }) + "\\n");
}
afterAll(() => resetFileModuleGraph());`,
      );
      const mock = (name: string) =>
        `vi.mock("./service", () => ({ service: { name: "${name}", cache: new Map() }, readEnv: () => "${name}" }));`;
      const leakChecks = `
        expect(process.env.SPIKE_FLAG).toBeUndefined();
        expect(globalThis.__stubbed).toBeUndefined();
        expect(vi.isFakeTimers()).toBe(false);
        expect(globalThis[Symbol.for("spike:connector")].pid).toBe(process.pid);`;
      const dirty = `
        vi.stubEnv("SPIKE_FLAG", "dirty");
        vi.stubGlobal("__stubbed", 1);
        vi.useFakeTimers();`;
      const files: Record<string, string> = {
        "file-a.test.ts": `import { expect, it, vi } from "vitest";
${mock("mock-a")}
it("a", async () => { ${leakChecks}
  expect((await import("./service")).service.name).toBe("mock-a"); ${dirty} });`,
        "file-b.test.ts": `import { expect, it, vi } from "vitest";
${mock("mock-b")}
it("b", async () => { ${leakChecks}
  expect((await import("./service")).service.name).toBe("mock-b"); ${dirty} });`,
        "file-c.test.ts": `import { expect, it, vi } from "vitest";
it("c real module with an empty cache", async () => { ${leakChecks}
  const m = await import("./service");
  expect(m.service.name).toBe("real"); expect(m.service.cache.size).toBe(0);
  m.service.cache.set("k", "v"); ${dirty} });`,
        "file-d.test.ts": `import { expect, it, vi } from "vitest";
import * as real from "./service";
it("d spy does not outlive the file", () => { ${leakChecks}
  expect(real.service.cache.size).toBe(0);
  vi.spyOn(real, "readEnv"); ${dirty} });`,
        "file-e.test.ts": `import { expect, it, vi } from "vitest";
import * as real from "./service";
it("e", () => { ${leakChecks}
  expect(vi.isMockFunction(real.readEnv)).toBe(false); expect(real.service.cache.size).toBe(0); });`,
      };
      for (const [name, body] of Object.entries(files))
        await writeFile(path.join(root, name), body);

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
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      const timeout = setTimeout(() => {
        // Stop only the process/group created by this spec.
        if (pid === undefined) return;
        if (process.platform === "win32") child.kill();
        else {
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            // already gone
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
      expect(output).toMatch(/Test Files\s+5 passed/);
      const connects = (await readFile(ledger, "utf8")).trim().split("\n").filter(Boolean);
      expect(connects).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90000);
});

// The route handlers of the application must come from the file's own module
// graph: a file that mocks a use case behind a route sees its mock, and the
// real application modules load once per file, not once per worker.
describe("application modules per file on one worker", () => {
  it("serves each file's own vi.mock of a use case through createTestHttpServer({ loadAppModules: true })", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "warlock-worker-isolated-app-"));
    try {
      const manifest = require.resolve("vitest/package.json");
      await symlink(
        path.dirname(path.dirname(manifest)),
        path.join(root, "node_modules"),
        "junction",
      );
      const ledger = path.join(root, "ledger.jsonl");
      await writeFile(ledger, "");
      const write = async (relative: string, body: string) => {
        const file = path.join(root, relative);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, body);
      };
      await write("package.json", JSON.stringify({ name: "fixture", type: "module" }));
      await write("warlock.config.ts", "export default {};\n");
      await write(
        "tsconfig.json",
        JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" } }),
      );
      await write(
        "src/app/health/get-health.ts",
        `import { appendFileSync } from "node:fs";
appendFileSync(process.env.LEDGER, JSON.stringify({ type: "load-real", pid: process.pid }) + "\\n");
export const getHealth = () => ({ status: "ok" });`,
      );
      await write(
        "src/app/health/routes.ts",
        `import { router } from ${specifier("router/router.ts")};
import { $registerUseCase } from ${specifier("use-cases/use-cases-registry.ts")};
import { getHealth } from "./get-health";
$registerUseCase("health", { calls: 0 });
router.get("/health/live", ({ response }) => response.success(getHealth()));`,
      );
      await write(
        "vitest.config.mjs",
        `export default {
          server: { fs: { allow: [${JSON.stringify(root)}, ${JSON.stringify(source)}] } },
          test: {
            environment: "node", pool: "forks", isolate: false, maxWorkers: 1, fileParallelism: false,
            include: ["file-*.test.ts"], setupFiles: ["./setup.ts"],
            env: { LEDGER: ${JSON.stringify(ledger)}, NODE_ENV: "test" }
          }
        };`,
      );
      await write(
        "setup.ts",
        `import { afterAll, beforeAll } from "vitest";
import { cacheFake } from ${specifier("tests/fakes/cache-fake.ts")};
import { prepareFreshFile } from ${specifier("tests/fresh-module-graph.ts")};
import { testRuntimeScope } from ${specifier("tests/test-runtime-scope.ts")};
import { warlockConfigManager } from ${specifier("warlock-config/warlock-config.manager.ts")};
import { filesOrchestrator } from ${specifier("dev-server/files-orchestrator.ts")};
testRuntimeScope().freshModules = true;
await warlockConfigManager.load();
await filesOrchestrator.init({ skipLoader: true });
await prepareFreshFile();
beforeAll(async () => { await cacheFake.install(); });
afterAll(async () => { await cacheFake.restore(); await prepareFreshFile(); });`,
      );
      for (const [index, value] of ["mocked-a", "mocked-b", "mocked-c"].entries()) {
        await write(
          `file-${index}.test.ts`,
          `import { afterAll, expect, it, vi } from "vitest";
import { createTestHttpServer } from ${specifier("tests/test-http-server.ts")};
vi.mock("./src/app/health/get-health", () => ({ getHealth: () => ({ status: "${value}" }) }));
it("serves this file's mock", async () => {
  const app = await createTestHttpServer({ loadAppModules: true, importModule: (file) => import(file) });
  try {
    const response = await app.get("/health/live");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "${value}" });
  } finally { await app.close(); }
});`,
        );
      }
      await write(
        "file-3.test.ts",
        `import { expect, it } from "vitest";
import { createTestHttpServer } from ${specifier("tests/test-http-server.ts")};
it("serves the real module when a file does not mock it", async () => {
  const app = await createTestHttpServer({ loadAppModules: true, importModule: (file) => import(file) });
  try {
    expect(await (await app.get("/health/live")).json()).toEqual({ status: "ok" });
  } finally { await app.close(); }
});`,
      );
      const { code, output } = await runVitest(root, manifest);
      expect(code, output).toBe(0);
      expect(output).toMatch(/Test Files\s+4 passed/);
      expect(output).not.toMatch(/already registered/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90000);
});

async function runVitest(
  root: string,
  manifest: string,
): Promise<{ code: number | null; output: string }> {
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
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const timeout = setTimeout(() => {
    // Stop only the process/group created by this spec.
    if (pid === undefined) return;
    if (process.platform === "win32") child.kill();
    else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }, 60000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { code, output };
  } finally {
    clearTimeout(timeout);
  }
}
