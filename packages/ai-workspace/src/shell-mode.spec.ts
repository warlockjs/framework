import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDirectoryAsync, getFileAsync, removeDirectoryAsync } from "@warlock.js/fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspacePolicyError } from "./errors";
import { workspace } from "./workspace";
import type { Workspace, WorkspaceShellPolicy } from "./contracts";

// These tests spawn real processes through `/bin/sh` (POSIX only). Every
// process they start is a descendant of a command the workspace spawned;
// they are only probed (signal 0) and, if a test fails midway, stopped by
// their recorded PID.
const posix = process.platform !== "win32";

/** A one-line Node script, safe inside a double-quoted sh word (no `$`, backticks or `"`). */
const SPAWN_GRANDCHILD_AND_WAIT =
  "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});" +
  "console.log('child='+c.pid);console.log('ready');setInterval(()=>{},1000)";

/** Whether a PID we started is still alive (signal 0 only probes). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

/** Poll until `pid` is gone (or the deadline passes). */
async function waitUntilGone(pid: number, deadlineMs = 3_000): Promise<boolean> {
  const until = Date.now() + deadlineMs;

  while (Date.now() < until) {
    if (!alive(pid)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return !alive(pid);
}

/** The grandchild PID a script above printed. */
function grandchildPid(output: string): number {
  const match = /child=(\d+)/.exec(output);

  if (!match?.[1]) {
    throw new Error(`no child pid in output: ${output}`);
  }

  return Number(match[1]);
}

describe.runIf(posix)('shell mode (interpreter: "sh") over the real local backend', () => {
  let root: string;
  let outside: string;
  const started: number[] = [];
  const workspaces: Workspace[] = [];

  function make(shell: WorkspaceShellPolicy): Workspace {
    const ws = workspace({ cwd: root, shell: { inheritEnv: ["PATH"], ...shell } });

    workspaces.push(ws);

    return ws;
  }

  beforeEach(async () => {
    const base = join(tmpdir(), `ws-sh-${randomBytes(6).toString("hex")}`);

    root = join(base, "jail");
    outside = join(base, "outside");
    await ensureDirectoryAsync(root);
    await ensureDirectoryAsync(outside);
  });

  afterEach(async () => {
    for (const ws of workspaces.splice(0)) {
      await ws.dispose();
    }

    // Only PIDs these tests started (via the workspace) — never by name.
    for (const pid of started.splice(0)) {
      if (alive(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }

    await removeDirectoryAsync(join(root, ".."));
  });

  it("runs pipelines, && chains and cd inside the jail", async () => {
    const ws = make({ interpreter: "sh", allow: ["node", "echo", "cat"] });

    mkdirSync(join(root, "sub"));

    const result = await ws.exec(
      `echo one && cd sub && node -e "console.log(process.cwd())" | cat`,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`one\n${join(root, "sub")}\n`);
  });

  it("writes a redirection inside the jail", async () => {
    const ws = make({ interpreter: "sh", allow: ["echo"] });

    await ws.exec("echo hello > out.txt 2>/dev/null");

    expect(await getFileAsync(join(root, "out.txt"))).toBe("hello\n");
  });

  it("never runs a denied command hidden in a substitution", async () => {
    const ws = make({ interpreter: "sh", deny: ["mkdir"] });

    for (const line of [
      "echo $(mkdir hidden1)",
      "echo `mkdir hidden2`",
      "true; mkdir hidden3",
      "(mkdir hidden4)",
    ]) {
      await expect(ws.exec(line)).rejects.toMatchObject({
        type: "denied-command",
        reason: "denied-executable",
      });
    }

    for (const name of ["hidden1", "hidden2", "hidden3", "hidden4"]) {
      expect(existsSync(join(root, name))).toBe(false);
    }
  });

  it("refuses a redirection that escapes through a symlink", async () => {
    const ws = make({ interpreter: "sh", allow: ["echo"] });

    symlinkSync(outside, join(root, "link"), "dir");

    const attempt = ws.exec("echo leak > link/stolen.txt");

    await expect(attempt).rejects.toBeInstanceOf(WorkspacePolicyError);
    await expect(attempt).rejects.toMatchObject({ reason: "path-escape" });
    expect(existsSync(join(outside, "stolen.txt"))).toBe(false);

    await expect(ws.exec("cd link && echo x")).rejects.toMatchObject({ reason: "path-escape" });
  });

  it("kills the whole process tree on timeout", async () => {
    const ws = make({ interpreter: "sh", allow: ["node", "echo"], timeoutMs: 1_500 });

    const result = await ws.exec(`echo start && node -e "${SPAWN_GRANDCHILD_AND_WAIT}"`);
    const pid = grandchildPid(result.stdout);

    started.push(pid);

    expect(result.timedOut).toBe(true);
    expect(await waitUntilGone(pid)).toBe(true);
  });

  it("caps the captured output", async () => {
    const ws = make({ interpreter: "sh", allow: ["node", "cat"], maxOutputBytes: 100 });

    const result = await ws.exec(`node -e "process.stdout.write('x'.repeat(5000))" | cat`);

    expect(result.truncated).toBe(true);
    expect(result.stdout).toBe("x".repeat(100));
  });

  it("drops shell start-up variables from the environment", async () => {
    const ws = make({
      interpreter: "sh",
      allow: ["node"],
      env: { CI: "1", BASH_ENV: join(root, "evil.sh"), ENV: join(root, "evil.sh") },
    });

    const result = await ws.exec(
      `node -e "console.log([process.env.CI, process.env.BASH_ENV, process.env.ENV].join(','))"`,
    );

    expect(result.stdout.trim()).toBe("1,,");
  });

  it("runs a background command, streams its output, and kills its tree on dispose", async () => {
    const ws = make({ interpreter: "sh", allow: ["node"], background: {} });

    const job = await ws.startShell(`node -e "${SPAWN_GRANDCHILD_AND_WAIT}"`);

    expect(job.status).toBe("running");

    let output = "";

    for (let attempt = 0; attempt < 20 && !output.includes("ready"); attempt++) {
      output += (await ws.shellOutput(job.id, { waitMs: 500 })).stdout;
    }

    const pid = grandchildPid(output);

    started.push(pid);
    if (job.pid !== undefined) {
      started.push(job.pid);
    }

    expect(alive(pid)).toBe(true);

    await ws.dispose();

    expect(ws.listShells()[0]?.status).toBe("killed");
    expect(await waitUntilGone(pid)).toBe(true);
    await expect(ws.exec("node -v")).rejects.toThrow(/disposed/);
  });

  it("kills one background command's tree with shellKill (argv mode too)", async () => {
    const ws = make({ allow: ["node"], background: { maxJobs: 1 } });

    const job = await ws.startShell(`node -e "${SPAWN_GRANDCHILD_AND_WAIT}"`);
    let output = "";

    for (let attempt = 0; attempt < 20 && !output.includes("ready"); attempt++) {
      output += (await ws.shellOutput(job.id, { waitMs: 500 })).stdout;
    }

    const pid = grandchildPid(output);

    started.push(pid);

    const killed = await ws.shellKill(job.id);

    expect(killed.status).toBe("killed");
    expect(await waitUntilGone(pid)).toBe(true);
  });
});
