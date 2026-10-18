import { describe, expect, it, vi } from "vitest";
import { guardianAddress, launchCommand } from "../src/guardian";
import {
  darwinCommand,
  parseDarwinRows,
  parseDarwinStart,
  parseWindowsRows,
  portableIdentity,
  supported,
  taskkillCommand,
  treeMemory,
  UnsupportedProcessPlatformError,
  windowsCommand,
  type Command,
} from "../src/platform";
import { launcher, validateLimits } from "../src/resources";

const token = "a".repeat(64);
const stamp = "Mon Oct 19 12:34:56 2026";
const mac = `42 1 42 S 10 ${stamp}\n43 42 42 S 20 ${stamp}\n44 43 42 S 30 ${stamp}\n50 1 50 S 999 ${stamp}\n`;
const ticks = "639279812960000001";
const windows = JSON.stringify([
  { pid: 42, parent: 1, start: ticks, rss: 10 },
  { pid: 43, parent: 42, start: "639279812960000002", rss: 20 },
  { pid: 44, parent: 43, start: "639279812960000003", rss: 30 },
  { pid: 50, parent: 1, start: ticks, rss: 999 },
]);

it("parses Apple's C locale lstart to UTC epoch seconds including padded days", () => {
  expect(parseDarwinStart(stamp)).toBe(String(Date.UTC(2026, 9, 19, 12, 34, 56) / 1000));
  expect(parseDarwinStart(" Thu Jan  1 00:00:00 1970 \n")).toBe("0");
  expect(parseDarwinStart("Thu Feb 29 00:00:00 2024")).toBe(String(Date.UTC(2024, 1, 29) / 1000));
  for (const invalid of [
    "Thu Feb 30 00:00:00 2024",
    "Mon Oct 19 24:00:00 2026",
    "Sun Oct 19 12:34:56 2026",
    "Lun Oct 19 12:34:56 2026",
    `${stamp} UTC`,
  ])
    expect(() => parseDarwinStart(invalid)).toThrow("Invalid macOS");
});

it("constructs headerless macOS ps observations with fixed locale and timezone", () => {
  expect(darwinCommand(42)).toEqual({
    file: "/bin/ps",
    args: ["-p", "42", "-o", "pid=,ppid=,pgid=,state=,rss=,lstart="],
    env: { LC_ALL: "C", TZ: "UTC" },
  });
  expect(darwinCommand(42, true).args).toContain("-ax");
  expect(treeMemory(parseDarwinRows(mac), 42)).toBe(60 * 1024);
});

it("constructs noninteractive CIM commands and preserves creation-time precision", () => {
  const command = windowsCommand(42);
  expect(command.file).toBe("powershell.exe");
  expect(command.args.slice(0, 4)).toEqual([
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
  ]);
  expect(command.args[4]).toContain("Get-CimInstance Win32_Process -Filter 'ProcessId=42'");
  expect(command.args[4]).toContain("CreationDate.ToUniversalTime().Ticks.ToString");
  expect(command.args[4]).toContain("WorkingSetSize");
  expect(windowsCommand(42, true).args[4]).not.toContain("-Filter");
  expect(parseWindowsRows(windows)[0]?.start).toBe(ticks);
  expect(treeMemory(parseWindowsRows(windows), 42)).toBe(60);
  expect(parseWindowsRows("[]")).toEqual([]);
  expect(() => parseWindowsRows('{"pid":42}')).toThrow("Invalid Windows");
  expect(() =>
    parseWindowsRows('[{"pid":42,"parent":1,"start":639279812960000001,"rss":1}]'),
  ).toThrow("Invalid Windows");
});

it("does not count reused parent PIDs or count a cyclic snapshot twice", () => {
  const rows = parseWindowsRows(windows);
  rows.push({ pid: 60, parent: 42, group: 60, start: "639279812960000000", state: "R", rss: 999 });
  const root = rows[0];
  if (!root) throw new Error("Missing fixture root");
  root.parent = 44;
  expect(treeMemory(rows, 42)).toBe(60);
  expect(treeMemory(rows, 100)).toBe(0);
});

it("constructs only a forced PID tree taskkill and rejects unsafe PID inputs", () => {
  expect(taskkillCommand(42)).toEqual({ file: "taskkill.exe", args: ["/PID", "42", "/T", "/F"] });
  for (const pid of [0, 1, -42, 1.5, NaN, Infinity]) {
    expect(() => taskkillCommand(pid)).toThrow("Invalid process PID");
    expect(() => darwinCommand(pid)).toThrow("Invalid process PID");
    expect(() => windowsCommand(pid)).toThrow("Invalid process PID");
  }
});

it("supports the three implemented platforms with a typed error for other OSes", () => {
  for (const platform of ["linux", "darwin", "win32"])
    expect(() => supported(platform)).not.toThrow();
  expect(() => supported("freebsd")).toThrow(UnsupportedProcessPlatformError);
  expect(() => validateLimits({ cpuSeconds: 1 }, "win32")).toThrow("POSIX");
  expect(() => validateLimits({ virtualMemoryBytes: 1024 }, "win32")).toThrow("Linux");
  expect(() => validateLimits({ memoryBytes: 1024, timeoutMs: 1 }, "win32")).not.toThrow();
  expect(launcher({ cpuSeconds: 2, memoryBytes: 1024 }, "darwin")).toContain("ulimit -d 1");
  expect(launcher({}, "darwin")).not.toContain("kill -STOP");
  expect(launcher({}, "linux")).toContain('kill -STOP "$$"');
  expect(guardianAddress("win32", 42, 1000)).toBe("\\\\.\\pipe\\warlock-process-42");
  expect(guardianAddress("darwin", 42, 1000)).toBe("/tmp/warlock-process-1000-42.sock");
});

describe.each(["darwin", "win32"] as const)("injected %s observations", (platform) => {
  const snapshot = platform === "darwin" ? mac : windows;
  it("uses only injected commands and live environment proof, then rechecks start identity", async () => {
    const execute = vi.fn(async (_command: Command) => snapshot);
    const readProof = vi.fn(async () => ({ pid: 42, token, gated: true }));
    expect(await portableIdentity(platform, 42, true, execute, readProof)).toMatchObject({
      token,
      group: 42,
      state: "T",
      rss: platform === "darwin" ? 60 * 1024 : 60,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(readProof).toHaveBeenCalledWith(42);
  });
  it("rejects PID reuse across token observation", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(
        snapshot.replaceAll(
          platform === "darwin" ? stamp : ticks,
          platform === "darwin" ? "Tue Oct 20 12:34:56 2026" : "639279812970000001",
        ),
      );
    expect(
      await portableIdentity(platform, 42, true, execute, async () => ({
        pid: 42,
        token,
        gated: false,
      })),
    ).toBeUndefined();
  });
  it("does not manufacture a token for a live process without a guardian", async () => {
    const execute = vi.fn(async () => snapshot);
    expect(
      (await portableIdentity(platform, 42, true, execute, async () => undefined))?.token,
    ).toBeUndefined();
    expect(
      (
        await portableIdentity(platform, 42, true, execute, async () => ({
          pid: 99,
          token,
          gated: true,
        }))
      )?.token,
    ).toBeUndefined();
  });
  it("observes writer leases without requiring an ownership guardian", async () => {
    const proof = vi.fn(async () => undefined);
    expect(await portableIdentity(platform, 42, false, async () => snapshot, proof)).toBeDefined();
    expect(proof).not.toHaveBeenCalled();
    expect(
      await portableIdentity(platform, 99, false, async () => snapshot, proof),
    ).toBeUndefined();
  });
  it("propagates permission and command errors without signalling", async () => {
    await expect(
      portableIdentity(
        platform,
        42,
        true,
        async () => {
          throw new Error("access denied");
        },
        async () => undefined,
      ),
    ).rejects.toThrow("access denied");
  });
});

it.each(["darwin", "win32"])(
  "constructs a gated %s worker or PTY launch without interpolating user arguments",
  (platform) => {
    const plan = launchCommand(
      platform,
      "node",
      "worker",
      ["$(literal)", "argument with spaces"],
      {},
      {
        warlock_process_token: "untrusted",
        WARLOCK_PROCESS_TOKEN: "untrusted",
        WARLOCK_PROCESS_LAUNCH: "untrusted",
      },
      token,
    );
    expect(plan.file).toBe(platform === "win32" ? "node" : "/bin/sh");
    expect(plan.args.join(" ")).not.toContain("$(literal)");
    expect(JSON.parse(plan.env.WARLOCK_PROCESS_LAUNCH ?? "")).toEqual([
      "worker",
      "$(literal)",
      "argument with spaces",
    ]);
    expect(plan.env.WARLOCK_PROCESS_TOKEN).toBe(token);
    if (platform === "win32") expect(plan.env.warlock_process_token).toBeUndefined();
  },
);
