import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { identity } from "./identity";
import type { ProcessInfo } from "./types";

export type RegistryEntry = ProcessInfo & {
  token: string;
  start: string;
  cgroup?: string;
  /** Persisted launch gate: recovery may resume an adopted, interrupted launch. */
  gated?: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is Record<string, string> {
  return record(value) && Object.values(value).every((item) => typeof item === "string");
}
export function parseRegistry(source: string, owner: string): RegistryEntry[] {
  const value: unknown = JSON.parse(source);
  if (
    !record(value) ||
    value.version !== 1 ||
    value.owner !== owner ||
    !Array.isArray(value.entries)
  )
    throw new Error("Invalid process registry or different owner");
  const entries: RegistryEntry[] = [];
  for (const entry of value.entries) {
    if (
      !record(entry) ||
      entry.owner !== owner ||
      typeof entry.pid !== "number" ||
      !Number.isSafeInteger(entry.pid) ||
      Number(entry.pid) <= 1 ||
      typeof entry.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.token) ||
      typeof entry.start !== "string" ||
      typeof entry.type !== "string" ||
      typeof entry.command !== "string" ||
      !Array.isArray(entry.args) ||
      !entry.args.every((arg) => typeof arg === "string") ||
      !strings(entry.labels) ||
      typeof entry.startedAt !== "number" ||
      !Number.isFinite(entry.startedAt) ||
      entry.startedAt < 0 ||
      !record(entry.limits) ||
      !Object.entries(entry.limits).every(
        ([key, limit]) =>
          ["timeoutMs", "memoryBytes", "cpuSeconds", "virtualMemoryBytes"].includes(key) &&
          typeof limit === "number" &&
          Number.isSafeInteger(limit) &&
          limit > 0,
      ) ||
      !["cgroup-v2", "rlimit-polling"].includes(String(entry.enforcement)) ||
      typeof entry.peakMemoryBytes !== "number" ||
      !Number.isFinite(entry.peakMemoryBytes) ||
      entry.peakMemoryBytes < 0 ||
      (entry.cgroup !== undefined && typeof entry.cgroup !== "string") ||
      (entry.gated !== undefined && typeof entry.gated !== "boolean")
    )
      throw new Error("Invalid process registry entry");
    entries.push(entry as RegistryEntry);
  }
  if (new Set(entries.map((entry) => entry.pid)).size !== entries.length)
    throw new Error("Duplicate registry PID");
  return entries;
}

/** One writer per registry. A crash leaves a lease which only a dead identity can release. */
export class Registry {
  private queue: Promise<void> = Promise.resolve();
  private locked = false;
  constructor(
    public readonly file: string,
    private readonly owner: string,
  ) {}
  async open(): Promise<RegistryEntry[]> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const self = await identity(process.pid);
    if (!self) throw new Error("Cannot verify registry writer identity");
    const lock = `${this.file}.lock`;
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const reclaim = `${lock}.reclaim`;
      await mkdir(reclaim, { mode: 0o700 });
      try {
        const lease: unknown = JSON.parse(await readFile(path.join(lock, "writer.json"), "utf8"));
        if (!record(lease) || typeof lease.pid !== "number" || typeof lease.start !== "string")
          throw new Error("Invalid registry writer lease; inspect it manually");
        const writer = await identity(lease.pid);
        if (writer?.start === lease.start) throw new Error("Process registry is already in use");
        const stale = `${lock}.${randomBytes(8).toString("hex")}`;
        await rename(lock, stale);
        await rm(stale, { recursive: true });
        await mkdir(lock, { mode: 0o700 });
      } finally {
        await rm(reclaim, { recursive: true });
      }
    }
    this.locked = true;
    try {
      await writeFile(
        path.join(lock, "writer.json"),
        JSON.stringify({ pid: process.pid, start: self.start }),
        { mode: 0o600 },
      );
      try {
        return parseRegistry(await readFile(this.file, "utf8"), this.owner);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  save(entries: RegistryEntry[]): Promise<void> {
    const source = JSON.stringify({ version: 1, owner: this.owner, entries }, null, 2) + "\n";
    const next = this.queue.then(async () => {
      const temporary = `${this.file}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        await writeFile(temporary, source, { mode: 0o600, flag: "wx" });
        await rename(temporary, this.file);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
  async close(): Promise<void> {
    await this.queue;
    if (this.locked) {
      await rm(`${this.file}.lock`, { recursive: true });
      this.locked = false;
    }
  }
}
