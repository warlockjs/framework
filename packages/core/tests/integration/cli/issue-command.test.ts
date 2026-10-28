import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CORE_ROOT = path.resolve(__dirname, "../../..");
const TEMP_ROOT = path.resolve(CORE_ROOT, "../../.tmp");
const TIMEOUT_MS = 180_000;
const coreVersion = (
  JSON.parse(readFileSync(path.join(CORE_ROOT, "package.json"), "utf8")) as { version: string }
).version;
let fixture: string;

beforeAll(async () => {
  await mkdir(TEMP_ROOT, { recursive: true });
  fixture = await mkdtemp(path.join(TEMP_ROOT, "issue-cli-"));
  await writeFile(
    path.join(fixture, "package.json"),
    '{"name":"generic-fixture","type":"module","private":true}',
  );
  await writeFile(
    path.join(fixture, "warlock.config.ts"),
    'throw new Error("CONFIG_MUST_NOT_EXECUTE"); export default { build: { minify: false } };',
  );
  await writeFile(path.join(fixture, ".env"), "TOKEN=ENV_MUST_NOT_APPEAR");
  await mkdir(path.join(fixture, "src/app"), { recursive: true });
  await writeFile(
    path.join(fixture, "src/app/bootstrap.ts"),
    'throw new Error("APP_MUST_NOT_BOOT");',
  );
  const scope = path.join(fixture, "node_modules/@warlock.js");
  await mkdir(scope, { recursive: true });
  await symlink(CORE_ROOT, path.join(scope, "core"), "junction");
});

afterAll(async () => {
  await rm(fixture, { recursive: true, force: true });
});

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(CORE_ROOT, "bin/warlock.js"), "issue", ...args],
      {
        cwd: fixture,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "test", npm_config_user_agent: "pnpm/11.24.0" },
      },
    );
    // Record the PID and only ever terminate this test's own child.
    const childPid = child.pid;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      if (child.pid === childPid) child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("warlock issue without a bootable app", () => {
  it(
    "returns clean JSON despite throwing config/bootstrap and a secret .env",
    async () => {
      const result = await runCli(["--json", "--title", "Public bug"]);
      expect(result.code, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(Object.keys(report)).toEqual(["schemaVersion", "environment", "url"]);
      expect(report.schemaVersion).toBe(1);
      expect(report.environment.packages["@warlock.js/core"]).toBe(coreVersion);
      expect(report.environment.config.buildFlags).toEqual({ minify: false });
      expect(new URL(report.url).searchParams.get("title")).toBe("Public bug");
      expect(result.stdout + result.stderr).not.toMatch(/MUST_NOT_|generic-fixture/);
    },
    TIMEOUT_MS + 5_000,
  );

  it(
    "prepares a feature even with syntactically invalid config",
    async () => {
      await writeFile(path.join(fixture, "warlock.config.ts"), "export default defineConfig({");
      const result = await runCli(["--type", "feature", "--json"]);
      expect(result.code, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.environment.config.status).toBe("unparsed");
      expect(new URL(report.url).searchParams.get("template")).toBe("feature.yml");
      expect(result.stdout + result.stderr).not.toContain("APP_MUST_NOT_BOOT");
    },
    TIMEOUT_MS + 5_000,
  );
});
