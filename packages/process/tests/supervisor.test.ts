import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  supervisor,
  ProcessNotOwnedError,
  type ProcessHandle,
  type ProcessSupervisor,
} from "../src";
import { identity, TOKEN_ENV } from "../src/identity";
import { parseRegistry, type RegistryEntry } from "../src/registry";

let directory: string;
const supervisors: ProcessSupervisor[] = [];
const handles: ProcessHandle[] = [];
const fixtureChildren: ReturnType<typeof spawn>[] = [];

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "warlock-process-"));
});
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const instance of supervisors.splice(0)) await instance.stopAll().catch(() => undefined);
  // These are children created by this spec, recorded immediately after spawn.
  for (const child of fixtureChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
  await rm(directory, { recursive: true, force: true });
});

function create(extra: Partial<Parameters<typeof supervisor>[0]> = {}) {
  const instance = supervisor({
    owner: "example-app",
    registry: path.join(directory, "registry.json"),
    pollIntervalMs: 20,
    stopGraceMs: 40,
    cgroupRoot: path.join(directory, "no-delegation"),
    ...extra,
  });
  supervisors.push(instance);
  return instance;
}
async function child(
  instance: ProcessSupervisor,
  source = "setTimeout(() => {}, 2000)",
  labels = {},
) {
  const handle = await instance.spawn({
    kind: "worker",
    command: process.execPath,
    args: ["-e", source],
    labels,
  });
  handles.push(handle);
  handle.stdout.resume();
  handle.stderr.resume();
  return handle;
}

/** A registry fixture uses only a PID, token and group created by this spec. */
async function orphan(
  overrides: Partial<RegistryEntry> = {},
  argumentsAfterScript: string[] = [],
  source = "setTimeout(() => {}, 3000)",
): Promise<RegistryEntry> {
  const token = randomBytes(32).toString("hex");
  const fixture = spawn(process.execPath, ["-e", source, ...argumentsAfterScript], {
    detached: true,
    env: { ...process.env, [TOKEN_ENV]: token },
    stdio: "ignore",
  });
  fixtureChildren.push(fixture);
  await once(fixture, "spawn");
  if (!fixture.pid) throw new Error("Fixture did not start");
  const current = await identity(fixture.pid, true);
  if (!current) throw new Error("Fixture identity unavailable");
  const entry: RegistryEntry = {
    pid: fixture.pid,
    token,
    start: current.start,
    owner: "example-app",
    type: "worker",
    command: process.execPath,
    args: [],
    labels: { room: "one" },
    startedAt: Date.now(),
    limits: {},
    enforcement: "rlimit-polling",
    peakMemoryBytes: 0,
    ...overrides,
  };
  await writeFile(
    path.join(directory, "registry.json"),
    JSON.stringify({ version: 1, owner: "example-app", entries: [entry] }),
  );
  return entry;
}

let hasPty = false;
try {
  createRequire(import.meta.url).resolve("node-pty");
  hasPty = true;
} catch {
  /* Optional peer is absent. */
}

describe.skipIf(
  process.platform !== "linux" &&
    !(process.platform === "darwin" && process.env.WARLOCK_PROCESS_IDENTITY_HELPER),
)("owned process supervision", () => {
  it("streams output, reports natural exit and removes the private registry entry", async () => {
    const instance = create();
    const handle = await instance.spawn({
      kind: "worker",
      command: process.execPath,
      args: [
        "-e",
        'console.log("ready"); console.error("detail"); setTimeout(() => process.exit(7), 100)',
      ],
    });
    handles.push(handle);
    const outputEnded = once(handle.stdout, "end");
    const errorsEnded = once(handle.stderr, "end");
    let output = "";
    let errors = "";
    handle.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    handle.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    expect(await handle.exited).toMatchObject({ reason: "exit", code: 7 });
    await Promise.all([outputEnded, errorsEnded]);
    expect(output).toContain("ready");
    expect(errors).toContain("detail");
    expect(await instance.list()).toEqual([]);
    expect(
      JSON.parse(await readFile(path.join(directory, "registry.json"), "utf8")).entries,
    ).toEqual([]);
  });

  it("records a random environment token and process start time without exposing them in list", async () => {
    const instance = create();
    const handle = await child(instance);
    const entries = parseRegistry(
      await readFile(path.join(directory, "registry.json"), "utf8"),
      "example-app",
    );
    const entry = entries[0];
    if (!entry) throw new Error("Missing registry entry");
    expect(entry.token).toMatch(/^[a-f0-9]{64}$/);
    expect(await identity(handle.pid, true)).toMatchObject({
      token: entry.token,
      start: entry.start,
      group: handle.pid,
    });
    expect((await stat(path.join(directory, "registry.json"))).mode & 0o777).toBe(0o600);
    expect(await instance.list()).toEqual([
      expect.not.objectContaining({ token: expect.anything() }),
    ]);
  });

  it("stops matching labels only, and handle stop is idempotent", async () => {
    const instance = create();
    const first = await child(instance, undefined, { room: "one", member: "a" });
    const second = await child(instance, undefined, { room: "two" });
    expect(await instance.list({ labels: { room: "one" } })).toHaveLength(1);
    await instance.stop({ labels: { room: "one", member: "a" } });
    expect(await first.exited).toMatchObject({ reason: "stopped" });
    expect(await instance.list()).toMatchObject([{ pid: second.pid }]);
    await first.stop();
    await first.stop();
  });

  it("refuses an unregistered PID even when another child has the same command", async () => {
    const instance = create();
    const owned = await child(instance);
    const outside = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], {
      stdio: "ignore",
    });
    fixtureChildren.push(outside);
    await once(outside, "spawn");
    if (!outside.pid) throw new Error("Missing fixture PID");
    await expect(instance.stopPid(outside.pid)).rejects.toBeInstanceOf(ProcessNotOwnedError);
    await expect(instance.stopPid(process.pid)).rejects.toBeInstanceOf(ProcessNotOwnedError);
    expect(outside.exitCode).toBeNull();
    await owned.stop();
  });

  it("rejects name and pattern filters instead of accidentally stopping every child", async () => {
    const instance = create();
    const handle = await child(instance);
    const invalid = { name: "node" };
    // JavaScript callers can pass extra properties; exercise runtime validation.
    await expect(Reflect.apply(instance.stop, instance, [invalid])).rejects.toThrow(
      "Only label filters",
    );
    await expect(Reflect.apply(instance.stop, instance, [{ pattern: ".*" }])).rejects.toThrow(
      "Only label filters",
    );
    expect(await instance.list()).toMatchObject([{ pid: handle.pid }]);
  });

  it("stops every registered child when stop has no label filter", async () => {
    const instance = create();
    const first = await child(instance);
    const second = await child(instance);
    await instance.stop();
    expect(await first.exited).toMatchObject({ reason: "stopped" });
    expect(await second.exited).toMatchObject({ reason: "stopped" });
    expect(await instance.list()).toEqual([]);
  });

  it("does not change supervisor ownership when the caller edits its options", async () => {
    const options = { owner: "example-app", registry: path.join(directory, "registry.json") };
    const instance = supervisor(options);
    supervisors.push(instance);
    options.owner = "changed-owner";
    options.registry = path.join(directory, "changed.json");
    const handle = await child(instance);
    expect(await instance.list()).toMatchObject([{ pid: handle.pid, owner: "example-app" }]);
  });

  it("times out children and reports sampled peak memory", async () => {
    const instance = create({ defaults: { timeoutMs: 150 } });
    const handle = await child(instance);
    const result = await handle.exited;
    expect(result.reason).toBe("timeout");
    expect(result.peakMemoryBytes).toBeGreaterThan(0);
  });

  it.skipIf(process.platform !== "linux")(
    "falls back without delegation and enforces the sampled RSS cap",
    async () => {
      const instance = create({ defaults: { memoryBytes: 24 * 1024 * 1024 } });
      const handle = await child(
        instance,
        "const bytes = Buffer.alloc(48 * 1024 * 1024, 1); setTimeout(() => console.log(bytes.length), 1500)",
      );
      expect((await instance.list())[0]?.enforcement).toBe("rlimit-polling");
      expect(await handle.exited).toMatchObject({
        reason: "memory-cap",
        peakMemoryBytes: expect.any(Number),
      });
    },
  );

  it.skipIf(process.platform !== "linux" || !process.env.WARLOCK_PROCESS_CGROUP_ROOT)(
    "enforces a delegated cgroup memory cap before running the workload",
    async () => {
      const instance = create({
        cgroupRoot: process.env.WARLOCK_PROCESS_CGROUP_ROOT,
        defaults: { memoryBytes: 96 * 1024 * 1024 },
      });
      const handle = await child(
        instance,
        "setTimeout(() => { const bytes = Buffer.alloc(192 * 1024 * 1024, 1); setTimeout(() => console.log(bytes.length), 1000); }, 100)",
      );
      expect((await instance.list())[0]?.enforcement).toBe("cgroup-v2");
      expect(await handle.exited).toMatchObject({ reason: "memory-cap" });
    },
  );

  it("serializes concurrent spawns with shutdown and closes the supervisor", async () => {
    const instance = create();
    const spawning = child(instance);
    const shutdown = instance.stopAll();
    const handle = await spawning;
    await shutdown;
    expect(await handle.exited).toMatchObject({ reason: "stopped" });
    await instance.stopAll();
    await expect(instance.spawn({ kind: "worker", command: process.execPath })).rejects.toThrow(
      "shut down",
    );
  });

  it("refuses a second active writer for the same registry", async () => {
    const first = create();
    await first.recover();
    await expect(create().recover()).rejects.toThrow("already in use");
  });

  it("adopts a verified orphan selected by keep and can stop it by PID", async () => {
    const entry = await orphan();
    const instance = create();
    expect(await instance.recover({ keep: (row) => row.labels.room === "one" })).toEqual({
      adopted: [entry.pid],
      stopped: [],
      cleared: [],
    });
    expect(await instance.recover()).toEqual({ adopted: [], stopped: [], cleared: [] });
    await instance.stopPid(entry.pid);
    expect(await instance.list()).toEqual([]);
  });

  it("stops verified orphans by default before accepting new children", async () => {
    const entry = await orphan();
    const instance = create();
    await expect(child(instance)).rejects.toThrow("recover()");
    expect(await instance.recover()).toEqual({ adopted: [], stopped: [entry.pid], cleared: [] });
  });

  it("resumes a verified interrupted launch when recovery adopts it", async () => {
    const entry = await orphan(
      { gated: true },
      [],
      'process.kill(process.pid, "SIGSTOP"); setTimeout(() => {}, 3000)',
    );
    const deadline = Date.now() + 1000;
    while ((await identity(entry.pid))?.state !== "T") {
      if (Date.now() >= deadline) throw new Error("Fixture did not reach its launch gate");
      await delay(10);
    }
    const instance = create();
    expect(await instance.recover({ keep: () => true })).toMatchObject({ adopted: [entry.pid] });
    while ((await identity(entry.pid))?.state === "T") {
      if (Date.now() >= deadline) throw new Error("Recovery did not resume the launch gate");
      await delay(10);
    }
    expect((await identity(entry.pid))?.state).not.toBe("T");
    await instance.stopPid(entry.pid);
  });

  it.each(["token", "start"] as const)(
    "refuses to stop a registered PID whose %s no longer matches",
    async (field) => {
      const entry = await orphan(
        field === "token" ? { token: "0".repeat(64) } : { start: "stale-start" },
      );
      const instance = create();
      await expect(instance.stopPid(entry.pid)).rejects.toBeInstanceOf(ProcessNotOwnedError);
      expect(await identity(entry.pid)).toBeDefined();
    },
  );

  it.each(["token", "start"] as const)(
    "clears stale %s identity without signalling the live fixture",
    async (field) => {
      const entry = await orphan(
        field === "token" ? { token: "0".repeat(64) } : { start: "stale-start" },
        [`WARLOCK_PROCESS_TOKEN=${"0".repeat(64)}`],
      );
      const instance = create();
      expect(await instance.recover()).toEqual({
        adopted: [],
        stopped: [],
        cleared: [entry.pid],
      });
      expect(await identity(entry.pid)).toBeDefined();
      await expect(instance.stopPid(entry.pid)).rejects.toBeInstanceOf(ProcessNotOwnedError);
    },
  );

  it("reclaims a dead writer lease using its exact recorded start identity", async () => {
    const entry = await orphan();
    const lock = path.join(directory, "registry.json.lock");
    await mkdir(lock);
    // This PID was started by the spec; a mismatched start proves the lease is stale.
    await writeFile(
      path.join(lock, "writer.json"),
      JSON.stringify({ pid: entry.pid, start: "old-identity" }),
    );
    const instance = create();
    expect(await instance.recover({ keep: () => true })).toMatchObject({ adopted: [entry.pid] });
  });

  it("signals only the child's isolated group, including its inherited descendants", async () => {
    const instance = create();
    const handle = await instance.spawn({
      kind: "worker",
      command: process.execPath,
      args: [
        "-e",
        `const { spawn } = require("node:child_process");
      const descendant = spawn(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], { stdio: "ignore" });
      console.log(descendant.pid); setTimeout(() => {}, 2000);`,
      ],
    });
    handles.push(handle);
    handle.stderr.resume();
    const [chunk] = (await once(handle.stdout, "data")) as [Buffer];
    const descendant = Number(chunk.toString().trim());
    expect(descendant).toBeGreaterThan(1);
    await handle.stop();
    // Observation only: this spec never signals a discovered PID.
    const deadline = Date.now() + 1000;
    while (await identity(descendant)) {
      if (Date.now() >= deadline) throw new Error("Descendant did not stop");
      await delay(20);
    }
    expect(await handle.exited).toMatchObject({ reason: "stopped" });
  });

  it.skipIf(!hasPty || process.env.WARLOCK_PROCESS_PTY_TESTS !== "1")(
    "starts and stops an owned terminal with the optional peer",
    async () => {
      const instance = create();
      const terminal = await instance.spawnPty({
        kind: "terminal",
        command: "/bin/sh",
        labels: { room: "one" },
      });
      handles.push(terminal);
      terminal.stdout.resume();
      terminal.stderr.resume();
      terminal.resize(100, 30);
      terminal.write("printf 'ready\\n'\n");
      expect(await instance.list()).toMatchObject([{ pid: terminal.pid, type: "terminal" }]);
      await terminal.stop();
      expect(await terminal.exited).toMatchObject({ reason: "stopped" });
    },
  );

  it("fails closed for a different registry owner", async () => {
    await orphan();
    await expect(create({ owner: "other-app" }).recover()).rejects.toThrow("different owner");
  });
});

it("rejects invalid resource limits before launching anything", () => {
  expect(() => create({ defaults: { timeoutMs: -1 } })).toThrow("Invalid process limit");
});

it("rejects corrupt registry identities", () => {
  expect(() =>
    parseRegistry('{"version":1,"owner":"example-app","entries":[{"pid":1}]}', "example-app"),
  ).toThrow("Invalid process registry entry");
  expect(() => parseRegistry("{", "example-app")).toThrow();
});

it.skipIf(process.platform !== "win32")("rejects Windows before creating a child", async () => {
  await expect(create().spawn({ kind: "worker", command: process.execPath })).rejects.toThrow(
    "native Job Object",
  );
});
