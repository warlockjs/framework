import { afterEach, describe, expect, it, vi } from "vitest";

/** Each /proc/<pid>/stat read takes the next snapshot; the last one repeats. */
const statReads: string[] = [];
const files = new Map<string, string | NodeJS.ErrnoException>();

vi.mock("node:fs/promises", () => ({
  readFile: async (file: string) => {
    if (file === "/proc/4242/stat" && statReads.length > 0)
      return statReads.length > 1 ? statReads.shift() : statReads[0];
    const value = files.get(file);
    if (value === undefined) throw Object.assign(new Error(`ENOENT ${file}`), { code: "ENOENT" });
    if (value instanceof Error) throw value;
    return value;
  },
}));

const { identity, TOKEN_ENV } = await import("../src/identity");

/** Fields after the command name: state, ppid, pgrp, ... starttime (22), vsize (23), rss (24). */
function stat(vsize: string, state = "S"): string {
  const fields = [state, "1", "4242", ...Array.from({ length: 16 }, () => "0"), "900", vsize, "10"];
  return `4242 (node) ${fields.join(" ")}`;
}

function denied(): NodeJS.ErrnoException {
  return Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
}

function linuxProcess(environ: string | NodeJS.ErrnoException, ...snapshots: string[]): void {
  statReads.push(...snapshots);
  files.set("/proc/sys/kernel/random/boot_id", "boot\n");
  files.set("/proc/4242/status", "VmRSS:\t   8 kB\n");
  files.set("/proc/4242/environ", environ);
}

describe.runIf(process.platform === "linux")("linux identity", () => {
  afterEach(() => {
    statReads.length = 0;
    files.clear();
  });

  it("reads the token of a live child", async () => {
    linuxProcess(`PATH=/bin\0${TOKEN_ENV}=secret\0`, stat("1024"));
    await expect(identity(4242, true)).resolves.toMatchObject({
      start: "boot:900",
      group: 4242,
      token: "secret",
      rss: 8192,
    });
  });

  it("treats a task that already released its memory map as gone", async () => {
    linuxProcess(`${TOKEN_ENV}=secret\0`, stat("0"));
    await expect(identity(4242, true)).resolves.toBeUndefined();
  });

  it("treats the unreadable environment of a task that started exiting as gone", async () => {
    linuxProcess(denied(), stat("1024"), stat("0"));
    await expect(identity(4242, true)).resolves.toBeUndefined();
  });

  it("treats the unreadable environment of a task that became a zombie as gone", async () => {
    linuxProcess(denied(), stat("1024"), stat("0", "Z"));
    await expect(identity(4242, true)).resolves.toBeUndefined();
  });

  it("still fails closed when a live task's environment is unreadable", async () => {
    linuxProcess(denied(), stat("1024"));
    await expect(identity(4242, true)).rejects.toMatchObject({ code: "EACCES" });
  });
});
