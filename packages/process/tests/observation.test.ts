import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardianAddress, guardianProof, guardianScript } from "../src/guardian";
import * as identities from "../src/identity";
import { defaultObservationTimeoutMs, defaultPollIntervalMs } from "../src/platform";
import { Registry } from "../src/registry";
import { supervisor } from "../src/supervisor";
import * as helpers from "../src/windows-helper";

const originalPlatform = process.platform;
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

describe("platform defaults", () => {
  it("keeps Linux values and relaxes Windows and macOS", () => {
    expect(defaultPollIntervalMs("linux")).toBe(100);
    expect(defaultPollIntervalMs("win32")).toBeGreaterThanOrEqual(1000);
    expect(defaultPollIntervalMs("darwin")).toBeGreaterThan(100);
    expect(defaultObservationTimeoutMs("linux")).toBe(2000);
    expect(defaultObservationTimeoutMs("win32")).toBeGreaterThanOrEqual(10_000);
    expect(defaultObservationTimeoutMs("darwin")).toBeGreaterThanOrEqual(10_000);
  });
});

describe("observationTimeoutMs", () => {
  const base = { owner: "example-app", registry: "unused-registry.json" };

  it("rejects values that cannot be a timeout", () => {
    for (const value of [0, 99, 1.5, Number.NaN])
      expect(() => supervisor({ ...base, observationTimeoutMs: value })).toThrow(
        "observationTimeoutMs",
      );
  });

  it.each([
    [undefined, 15_000],
    [30_000, 30_000],
  ])("reaches the ownership check and the Windows helper (%s)", async (option, expected) => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.spyOn(Registry.prototype, "open").mockResolvedValue([
      {
        pid: 42,
        owner: "example-app",
        token: "a".repeat(64),
        start: "1",
        type: "worker",
        command: "worker.exe",
        args: [],
        labels: {},
        limits: {},
        enforcement: "rss-polling",
        startedAt: 0,
        peakMemoryBytes: 0,
      },
    ]);
    vi.spyOn(Registry.prototype, "save").mockResolvedValue();
    vi.spyOn(Registry.prototype, "close").mockResolvedValue();
    const created = vi.spyOn(helpers, "createWindowsHelper");
    const owns = vi.spyOn(identities, "owns").mockResolvedValue(false);
    const instance = supervisor({ ...base, observationTimeoutMs: option });
    await expect(instance.stopPid(42)).rejects.toBeInstanceOf(identities.ProcessNotOwnedError);
    expect(owns.mock.calls[0]?.[1]).toMatchObject({ timeoutMs: expected });
    expect(created).toHaveBeenCalledWith({ timeoutMs: expected });
    const helper = created.mock.results[0]?.value as helpers.WindowsProcessHelper;
    const close = vi.spyOn(helper, "close");
    await instance.stopAll().catch(() => undefined);
    expect(close).toHaveBeenCalledTimes(1);
  });

  describe("guardian client", () => {
    const servers: Server[] = [];
    afterEach(() => {
      for (const server of servers.splice(0)) server.close();
    });

    it("names the option in the timeout error", async () => {
      const pid = 900_000 + Math.floor(Math.random() * 90_000);
      const address = guardianAddress(process.platform, pid, process.getuid?.() ?? 0);
      const server = createServer((socket) => socket.on("error", () => undefined));
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(address, resolve));
      await expect(guardianProof(pid, "a".repeat(64), "a".repeat(64), 120)).rejects.toThrow(
        /timed out after 120 ms; raise the observationTimeoutMs/,
      );
    });
  });
});

describe("guardian reply order", () => {
  it("writes the reply before it spawns the workload", () => {
    const reply = guardianScript.indexOf("socket.end(");
    const launch = guardianScript.indexOf("setImmediate(launch)");
    expect(reply).toBeGreaterThan(-1);
    expect(launch).toBeGreaterThan(reply);
  });

  it.runIf(process.platform !== "win32")(
    "answers the resume request before the workload exists",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "warlock-order-"));
      const marker = path.join(directory, "started");
      const token = randomBytes(32).toString("hex");
      const guardian = spawn(process.execPath, ["-e", guardianScript], {
        env: {
          ...process.env,
          WARLOCK_PROCESS_TOKEN: token,
          WARLOCK_PROCESS_LAUNCH: JSON.stringify([
            process.execPath,
            "-e",
            `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "1")`,
          ]),
        },
        stdio: "ignore",
      });
      try {
        await once(guardian, "spawn");
        const pid = guardian.pid as number;
        let proof = await guardianProof(pid, undefined, token);
        for (let attempt = 0; !proof && attempt < 100; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          proof = await guardianProof(pid, undefined, token);
        }
        expect(proof?.gated).toBe(true);
        const resumed = await guardianProof(pid, token, token);
        expect(resumed).toMatchObject({ pid, gated: false });
        expect(existsSync(marker)).toBe(false);
        await once(guardian, "exit");
        expect(existsSync(marker)).toBe(true);
      } finally {
        if (guardian.exitCode === null && guardian.signalCode === null) guardian.kill("SIGKILL");
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

describe("sampling a process that is exiting", () => {
  const fake = (real: identities.Identity) => ({ ...real, token: undefined });
  async function run(freshStaysMismatched: boolean) {
    const directory = await mkdtemp(path.join(tmpdir(), "warlock-exit-"));
    const original = identities.identity;
    let armed = false;
    const instance = supervisor({
      owner: "example-app",
      registry: path.join(directory, "registry.json"),
      pollIntervalMs: 20,
      stopGraceMs: 40,
      cgroupRoot: path.join(directory, "none"),
    });
    const spy = vi
      .spyOn(identities, "identity")
      .mockImplementation(async (pid, token, expected, observation) => {
        const real = await original(pid, token, expected, observation);
        // Stale snapshot reads (polling) see a listed process without its token.
        if (armed && real && token && (freshStaysMismatched || observation?.maxAgeMs !== undefined))
          return fake(real);
        return real;
      });
    try {
      const handle = await instance.spawn({
        kind: "worker",
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 600)"],
      });
      armed = true;
      handle.stdout.resume();
      handle.stderr.resume();
      const outcome = await Promise.race([
        handle.exited.then(
          () => "exited",
          (error: unknown) =>
            error instanceof identities.ProcessNotOwnedError ? "not-owned" : "other",
        ),
        new Promise((resolve) => setTimeout(() => resolve("running"), 300)),
      ]);
      return { outcome, handle };
    } finally {
      spy.mockRestore();
      await instance.stopAll().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  }

  it.runIf(process.platform === "linux")(
    "re-reads fresh before calling a stale mismatch a failure",
    async () => {
      expect((await run(false)).outcome).toBe("running");
    },
  );

  it.runIf(process.platform === "linux")(
    "still reports a live process whose identity really differs",
    async () => {
      expect((await run(true)).outcome).toBe("not-owned");
    },
  );
});

describe.runIf(process.platform === "win32")("real Windows helper output shape", () => {
  it("returns zero, one and many rows", async () => {
    const helper = new helpers.WindowsProcessHelper();
    try {
      expect(await helper.query([2_000_000_000])).toHaveLength(0);
      const one = await helper.query([process.pid]);
      expect(one.map((row) => row.pid)).toEqual([process.pid]);
      expect((await helper.query([], true)).length).toBeGreaterThan(2);
    } finally {
      await helper.close();
    }
  }, 60_000);
});

describe("registry lease identity reads", () => {
  it("uses the injected reader for the writer's own identity", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "warlock-lease-"));
    try {
      const read = vi.fn(async (pid: number) => ({
        start: "s",
        group: pid,
        state: "R",
        rss: 0,
      }));
      const registry = new Registry(path.join(directory, "registry.json"), "example-app", read);
      await registry.open();
      expect(read).toHaveBeenCalledWith(process.pid);
      await registry.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("guardian that closes without answering", () => {
  it("is no proof rather than a parse error", async () => {
    const pid = 800_000 + Math.floor(Math.random() * 90_000);
    const address = guardianAddress(process.platform, pid, process.getuid?.() ?? 0);
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
      socket.on("data", () => socket.end());
    });
    await new Promise<void>((resolve) => server.listen(address, resolve));
    try {
      await expect(
        guardianProof(pid, "a".repeat(64), "a".repeat(64), 2000),
      ).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });
});

describe("stopping right after launch", () => {
  it.runIf(process.platform === "linux")(
    "waits out the launcher's exec window instead of refusing a live child",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "warlock-stop-"));
      const instance = supervisor({
        owner: "example-app",
        registry: path.join(directory, "registry.json"),
        pollIntervalMs: 1000,
        stopGraceMs: 40,
        cgroupRoot: path.join(directory, "none"),
      });
      try {
        const handle = await instance.spawn({
          kind: "worker",
          command: process.execPath,
          args: ["-e", "setTimeout(() => {}, 5000)"],
        });
        handle.stdout.resume();
        handle.stderr.resume();
        const original = identities.owns;
        let misses = 3;
        // Simulate the transient unverifiable state of an exec in progress.
        vi.spyOn(identities, "owns").mockImplementation(async (entry, observation) =>
          misses-- > 0 ? false : original(entry, observation),
        );
        await expect(handle.stop()).resolves.toBeUndefined();
        expect(misses).toBeLessThan(0);
      } finally {
        vi.restoreAllMocks();
        await instance.stopAll().catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
