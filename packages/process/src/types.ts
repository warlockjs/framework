import type { Readable, Writable } from "node:stream";

export type ProcessLimits = {
  timeoutMs?: number;
  memoryBytes?: number;
  /** POSIX RLIMIT_CPU, seconds. */
  cpuSeconds?: number;
  /** Linux RLIMIT_AS; distinct from resident memory, often unsuitable for V8. */
  virtualMemoryBytes?: number;
};
export type SupervisorOptions = {
  owner: string;
  /** Absolute or cwd-relative JSON file. One supervisor per registry. */
  registry: string;
  defaults?: ProcessLimits;
  pollIntervalMs?: number;
  stopGraceMs?: number;
  /** Linux delegated cgroup v2 directory; defaults to this process's cgroup. */
  cgroupRoot?: string;
};
export type SpawnOptions = {
  /** Workload category, for display only. */
  kind: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  labels?: Record<string, string>;
  limits?: ProcessLimits;
};
export type ProcessFilter = { labels?: Record<string, string> };
export type ProcessExit = {
  reason: "exit" | "timeout" | "memory-cap" | "stopped";
  code: number | null;
  signal: string | null;
  peakMemoryBytes: number;
};
export type ProcessInfo = {
  pid: number;
  owner: string;
  type: string;
  command: string;
  args: string[];
  labels: Record<string, string>;
  startedAt: number;
  limits: ProcessLimits;
  enforcement: "cgroup-v2" | "rlimit-polling";
  peakMemoryBytes: number;
};
export type ProcessHandle = {
  pid: number;
  stdout: Readable;
  stderr: Readable;
  stdin: Writable;
  exited: Promise<ProcessExit>;
  stop(): Promise<void>;
};
export type PtyHandle = ProcessHandle & {
  write(data: string): void;
  resize(columns: number, rows: number): void;
};
export type RecoveryResult = { adopted: number[]; stopped: number[]; cleared: number[] };
export type ProcessSupervisor = {
  spawn(options: SpawnOptions): Promise<ProcessHandle>;
  spawnPty(options: SpawnOptions & { columns?: number; rows?: number }): Promise<PtyHandle>;
  list(filter?: ProcessFilter): Promise<ProcessInfo[]>;
  stop(filter?: ProcessFilter): Promise<void>;
  stopPid(pid: number): Promise<void>;
  recover(options?: {
    keep?: (entry: ProcessInfo) => boolean | Promise<boolean>;
  }): Promise<RecoveryResult>;
  stopAll(): Promise<void>;
};
