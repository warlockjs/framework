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
