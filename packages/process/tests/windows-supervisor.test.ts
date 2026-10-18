import { afterEach, expect, it, vi } from "vitest";
import * as identities from "../src/identity";
import { Registry, type RegistryEntry } from "../src/registry";
import { supervisor } from "../src/supervisor";

const originalPlatform = process.platform;
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

it("routes Windows label stops, stopPid and stopAll through verified PID tree commands", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  const rows: RegistryEntry[] = [42, 43, 44].map((pid) => ({
    pid,
    owner: "example-app",
    token: "a".repeat(64),
    start: String(pid),
    type: "worker",
    command: "worker.exe",
    args: [],
    labels: { room: pid === 42 ? "one" : "two" },
    limits: {},
    enforcement: "rss-polling",
    startedAt: 0,
    peakMemoryBytes: 0,
  }));
  const alive = new Set(rows.map((row) => row.pid));
  vi.spyOn(Registry.prototype, "open").mockResolvedValue(rows);
  vi.spyOn(Registry.prototype, "save").mockResolvedValue();
  vi.spyOn(Registry.prototype, "close").mockResolvedValue();
  const owns = vi
    .spyOn(identities, "owns")
    .mockImplementation(async (entry) => alive.has(entry.pid));
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    throw new Error("Unexpected POSIX signal");
  });
  const execute = vi.spyOn(identities, "executeCommand").mockImplementation(async (command) => {
    const pid = Number(command.args[1]);
    expect(owns).toHaveBeenCalledWith(expect.objectContaining({ pid }));
    expect(command).toEqual({ file: "taskkill.exe", args: ["/PID", String(pid), "/T", "/F"] });
    alive.delete(pid);
    return "";
  });
  const instance = supervisor({ owner: "example-app", registry: "unused-registry.json" });
  await instance.stop({ labels: { room: "one" } });
  expect([...alive]).toEqual([43, 44]);
  await instance.stopPid(43);
  expect([...alive]).toEqual([44]);
  await instance.stopAll();
  expect(alive.size).toBe(0);
  expect(execute).toHaveBeenCalledTimes(3);
  expect(kill).not.toHaveBeenCalled();
});

it("refuses an identity mismatch on Windows without invoking taskkill", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  vi.spyOn(Registry.prototype, "open").mockResolvedValue([
    {
      pid: 42,
      owner: "example-app",
      token: "a".repeat(64),
      start: "old-start",
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
  vi.spyOn(identities, "owns").mockResolvedValue(false);
  vi.spyOn(Registry.prototype, "save").mockResolvedValue();
  vi.spyOn(Registry.prototype, "close").mockResolvedValue();
  const execute = vi.spyOn(identities, "executeCommand");
  const instance = supervisor({ owner: "example-app", registry: "unused-registry.json" });
  await expect(instance.stopPid(42)).rejects.toBeInstanceOf(identities.ProcessNotOwnedError);
  await instance.stopAll();
  expect(execute).not.toHaveBeenCalled();
});
