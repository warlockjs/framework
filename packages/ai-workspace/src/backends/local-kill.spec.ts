import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalBackend } from "./local";

const env: Record<string, string> = { PATH: process.env.PATH ?? "" };

// Spawns a detached grandchild (own process group, so the group kill cannot
// reach it) that inherits stdout and keeps the pipe open, records its pid in
// `pid.txt`, then stays alive itself.
const ESCAPEE = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
writeFileSync("pid.txt", String(child.pid));
child.unref();
process.stdout.write("started\\n");
setTimeout(() => {}, 30000);
`;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

describe("killed commands settle at the deadline", () => {
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `ws-kill-${randomBytes(6).toString("hex")}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "escapee.cjs"), ESCAPEE);
  });

  // Only the pid the spec's own script recorded is signalled.
  afterEach(async () => {
    const pidFile = join(root, "pid.txt");

    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8"));

      if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }

    await rm(root, { recursive: true, force: true });
  });

  it("returns shortly after the timeout although a grandchild holds stdout", async () => {
    const startedAt = Date.now();
    const result = await createLocalBackend().exec("node escapee.cjs", {
      cwd: root,
      env,
      timeoutMs: 1_000,
    });
    const elapsed = Date.now() - startedAt;

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(137);
    expect(result.stdout).toContain("started");
    expect(elapsed).toBeLessThan(2_500);
  }, 15_000);

  it("returns shortly after an abort although a grandchild holds stdout", async () => {
    const controller = new AbortController();
    const pending = createLocalBackend().exec("node escapee.cjs", {
      cwd: root,
      env,
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 800));

    const abortedAt = Date.now();

    controller.abort();

    const result = await pending;

    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(Date.now() - abortedAt).toBeLessThan(1_500);
  }, 15_000);

  it("settles a background job after kill even when a grandchild holds the pipes", async () => {
    const proc = createLocalBackend().start("node escapee.cjs", {
      cwd: root,
      env,
      onOutput: () => {},
    });

    await new Promise((resolve) => setTimeout(resolve, 800));

    const killedAt = Date.now();

    proc.kill();

    const { exitCode } = await proc.done;

    expect(exitCode).toBe(137);
    expect(Date.now() - killedAt).toBeLessThan(1_500);
  }, 15_000);
});
