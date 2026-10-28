import { spawn as spawnChild } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { identity, owns, ProcessNotOwnedError, executeCommand } from "./identity";
import { guardianProof, launchCommand } from "./guardian";
import { supported, taskkillCommand } from "./platform";
import { Registry, type RegistryEntry } from "./registry";
import {
  attachCgroup,
  cgroupMemory,
  cleanCgroup,
  recoveredCgroup,
  validateLimits,
} from "./resources";
import type {
  ProcessExit,
  ProcessFilter,
  ProcessHandle,
  ProcessInfo,
  ProcessSupervisor,
  PtyHandle,
  RecoveryResult,
  SpawnOptions,
  SupervisorOptions,
} from "./types";

type Pty = {
  pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(columns: number, rows: number): void;
};
type PtyModule = {
  spawn(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env: Record<string, string>;
      cols: number;
      rows: number;
      name: string;
    },
  ): Pty;
};
type Active = {
  entry: RegistryEntry;
  handle: ProcessHandle;
  reason?: ProcessExit["reason"];
  finish(code: number | null, signal: string | null): Promise<void>;
  stopping?: Promise<void>;
  timer?: ReturnType<typeof setInterval>;
  finished: boolean;
  adopted: boolean;
  fail(error: unknown): void;
};

function info(entry: RegistryEntry): ProcessInfo {
  const { token: _token, start: _start, cgroup: _cgroup, gated: _gated, ...visible } = entry;
  return structuredClone(visible);
}
function validateFilter(filter: ProcessFilter): void {
  if (
    !filter ||
    typeof filter !== "object" ||
    Array.isArray(filter) ||
    Object.keys(filter).some((key) => key !== "labels")
  )
    throw new Error("Only label filters are supported");
  if (
    filter.labels !== undefined &&
    (filter.labels === null ||
      typeof filter.labels !== "object" ||
      Array.isArray(filter.labels) ||
      !Object.values(filter.labels).every((value) => typeof value === "string"))
  )
    throw new Error("Labels must be string key/value pairs");
}
function matches(entry: RegistryEntry, filter: ProcessFilter): boolean {
  return Object.entries(filter.labels ?? {}).every(([key, value]) => entry.labels[key] === value);
}

export function supervisor(options: SupervisorOptions): ProcessSupervisor {
  for (const option of ["owner", "registry"] as const) {
    if (!options || typeof options[option] !== "string" || !options[option].trim()) {
      throw new TypeError(`Invalid supervisor configuration: ${option} must be a nonempty string`);
    }
  }
  validateLimits(options.defaults ?? {});
  // Caller-owned configuration must not change an active supervisor's identity.
  options = { ...options, defaults: { ...options.defaults } };
  const pollMs = options.pollIntervalMs ?? 100;
  const graceMs = options.stopGraceMs ?? 1000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 10 || !Number.isSafeInteger(graceMs) || graceMs < 0)
    throw new Error("Invalid polling interval or stop grace period");
  const registryPath = path.resolve(options.registry);
  // `warlock dev` can evaluate this module more than once in one process. A second supervisor over
  // the same registry would find its own process holding the lock, so reuse the live one.
  const sameProcess = sameProcessSupervisors();
  const live = sameProcess.get(registryPath);
  if (live && live.owner === options.owner) return live.api;
  const registry = new Registry(registryPath, options.owner);
  const entries = new Map<number, RegistryEntry>();
  const active = new Map<number, Active>();
  let ready: Promise<void> | undefined;
  let closing = false;
  let shutdown: Promise<void> | undefined;
  // Serialize public operations, including shutdown, so a gated spawn cannot escape stopAll.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation);
    queue = next.catch(() => undefined);
    return next;
  }
  async function open(): Promise<void> {
    supported(process.platform);
    if (closing) throw new Error("Supervisor has shut down");
    ready ??= registry.open().then((saved) => {
      for (const entry of saved) {
        delete entry.cgroup;
        entries.set(entry.pid, entry);
      }
    });
    await ready;
  }
  const save = () => registry.save([...entries.values()]);

  async function signal(entry: RegistryEntry, value: NodeJS.Signals): Promise<void> {
    if (!(await owns(entry))) throw new ProcessNotOwnedError(entry.pid);
    if (process.platform !== "linux" && value === "SIGCONT") {
      const proof = await guardianProof(entry.pid, entry.token);
      if (!proof || proof.token !== entry.token || proof.gated)
        throw new ProcessNotOwnedError(entry.pid);
      return;
    }
    if (process.platform === "win32") {
      try {
        await executeCommand(taskkillCommand(entry.pid));
      } catch (error) {
        if (await owns(entry)) throw error;
      }
      return;
    }
    // Negative PID targets only the session/group established for this child.
    // Recheck for every signal, including escalation; never match a command line.
    try {
      process.kill(-entry.pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  async function stopEntry(
    entry: RegistryEntry,
    reason: ProcessExit["reason"] = "stopped",
  ): Promise<void> {
    const tracked = active.get(entry.pid);
    let running: Active;
    if (!tracked) {
      if (!(await owns(entry))) throw new ProcessNotOwnedError(entry.pid);
      entry.cgroup = await recoveredCgroup(entry.pid, entry.token);
      running = track(entry);
    } else running = tracked;
    if (running.finished) return running.finish(null, null);
    if (running.stopping) return running.stopping;
    const stopping = (async () => {
      if (!(await owns(entry))) throw new ProcessNotOwnedError(entry.pid);
      running.reason ??= reason;
      await signal(entry, "SIGTERM");
      const deadline = Date.now() + graceMs;
      while (await owns(entry)) {
        if (Date.now() >= deadline) {
          await signal(entry, "SIGKILL");
          break;
        }
        await delay(20);
      }
      const killedDeadline = Date.now() + 5000;
      while (await owns(entry)) {
        if (Date.now() >= killedDeadline)
          throw new Error(`Process ${entry.pid} did not exit after SIGKILL`);
        await delay(20);
      }
      await running.finish(null, null);
    })();
    running.stopping = stopping;
    try {
      await stopping;
    } catch (error) {
      running.stopping = undefined;
      // The leader may exit between identity verification and a signal. A
      // missing identity is harmless for a tracked handle; a live mismatch is
      // still an ownership failure and must never receive another signal.
      if (error instanceof ProcessNotOwnedError && !(await identity(entry.pid))) {
        await running.finish(null, null);
        return;
      }
      throw error;
    }
  }

  function track(
    entry: RegistryEntry,
    streams?: Pick<ProcessHandle, "stdin" | "stdout" | "stderr">,
  ): Active {
    let resolveExit: (exit: ProcessExit) => void = () => undefined;
    let rejectExit: (error: unknown) => void = () => undefined;
    const exited = new Promise<ProcessExit>((resolve, reject) => {
      resolveExit = resolve;
      rejectExit = reject;
    });
    // A rejected persistence operation is still observable through handle.exited.
    void exited.catch(() => undefined);
    const stdout = streams?.stdout ?? new PassThrough();
    const stderr = streams?.stderr ?? new PassThrough();
    const stdin = streams?.stdin ?? new PassThrough();
    let finishing: Promise<void> | undefined;
    const running: Active = {
      entry,
      finished: false,
      adopted: !streams,
      fail: (error) => rejectExit(error),
      handle: {
        pid: entry.pid,
        stdout,
        stderr,
        stdin,
        exited,
        stop: () =>
          serial(async () => {
            if (!running.finished) await stopEntry(entry);
          }),
      },
      finish(code, sig) {
        finishing ??= (async () => {
          running.finished = true;
          clearInterval(running.timer);
          if (entry.cgroup) {
            const memory = await cgroupMemory(entry.cgroup);
            entry.peakMemoryBytes = Math.max(entry.peakMemoryBytes, memory.peak);
            if (memory.oom) running.reason = "memory-cap";
            await cleanCgroup(entry.cgroup);
          }
          active.delete(entry.pid);
          entries.delete(entry.pid);
          try {
            await save();
            resolveExit({
              reason: running.reason ?? "exit",
              code,
              signal: sig,
              peakMemoryBytes: entry.peakMemoryBytes,
            });
          } catch (error) {
            rejectExit(error);
            throw error;
          }
          if (!streams) {
            (stdout as PassThrough).end();
            (stderr as PassThrough).end();
            stdin.end();
          }
        })();
        return finishing;
      },
    };
    active.set(entry.pid, running);
    return running;
  }

  function monitor(running: Active): void {
    if (running.finished) return;
    let sampling = false;
    const sample = async () => {
      if (sampling || running.finished) return;
      sampling = true;
      try {
        const entry = running.entry;
        const current = await identity(entry.pid, true, entry.token);
        if (running.finished) return;
        if (
          current?.start !== entry.start ||
          current.token !== entry.token ||
          current.group !== entry.pid
        ) {
          if (!current) {
            if (running.adopted) await running.finish(null, null);
          } else {
            // A live child that changes its environment or group can no longer
            // be supervised safely. Preserve the entry and surface the failure.
            throw new ProcessNotOwnedError(entry.pid);
          }
          return;
        }
        entry.peakMemoryBytes = Math.max(entry.peakMemoryBytes, current.rss);
        if (entry.cgroup) {
          const memory = await cgroupMemory(entry.cgroup);
          if (running.finished) return;
          entry.peakMemoryBytes = Math.max(entry.peakMemoryBytes, memory.peak);
          if (memory.oom) running.reason = "memory-cap";
        }
        if (entry.limits.memoryBytes && entry.peakMemoryBytes > entry.limits.memoryBytes)
          await stopEntry(entry, "memory-cap");
        else if (entry.limits.timeoutMs && Date.now() - entry.startedAt >= entry.limits.timeoutMs)
          await stopEntry(entry, "timeout");
      } finally {
        sampling = false;
      }
    };
    running.timer = setInterval(() => {
      void sample().catch((error: unknown) => {
        // Never signal on an observation error. Surface it to the caller and keep the registry.
        clearInterval(running.timer);
        if (!running.finished) running.fail(error);
      });
    }, pollMs);
    running.timer.unref();
  }

  async function launch(
    input: SpawnOptions & { columns?: number; rows?: number },
    terminal: boolean,
  ): Promise<ProcessHandle | PtyHandle> {
    await open();
    if ([...entries.keys()].some((pid) => !active.has(pid)))
      throw new Error("Call recover() before spawning with an existing registry");
    if (
      typeof input.command !== "string" ||
      !input.command ||
      typeof input.kind !== "string" ||
      !input.kind
    )
      throw new Error("kind and command are required");
    validateFilter({ labels: input.labels });
    if (
      terminal &&
      [input.columns ?? 80, input.rows ?? 24].some(
        (size) => !Number.isSafeInteger(size) || size <= 0,
      )
    )
      throw new Error("Terminal dimensions must be positive safe integers");
    const limits = { ...options.defaults, ...input.limits };
    validateLimits(limits);
    const token = randomBytes(32).toString("hex");
    const {
      file: executable,
      args,
      env,
    } = launchCommand(
      process.platform,
      process.execPath,
      input.command,
      input.args ?? [],
      limits,
      { ...process.env, ...input.env },
      token,
    );
    let pid: number;
    let streams: Pick<ProcessHandle, "stdin" | "stdout" | "stderr">;
    let terminalProcess: Pty | undefined;
    let exit: { code: number | null; signal: string | null } | undefined;
    let spawnError: Error | undefined;
    let running: Active | undefined;
    const onExit = (code: number | null, sig: string | null) => {
      exit = { code, signal: sig };
      if (running) void running.finish(code, sig).catch(() => undefined);
    };
    if (terminal) {
      // Optional peer loaded only here. Structural types follow node-pty's official typings.
      const peer = "node-pty";
      const pty = (await import(peer)) as PtyModule;
      terminalProcess = pty.spawn(executable, args, {
        cwd: input.cwd,
        env: Object.fromEntries(
          Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined),
        ),
        cols: input.columns ?? 80,
        rows: input.rows ?? 24,
        name: "xterm-256color",
      });
      pid = terminalProcess.pid;
      const output = new PassThrough();
      const errors = new PassThrough();
      const instance = terminalProcess;
      const dataSubscription = instance.onData((data) => output.write(data));
      const inputStream = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          instance.write(chunk.toString());
          callback();
        },
      });
      const exitSubscription = instance.onExit((event) => {
        dataSubscription.dispose();
        exitSubscription.dispose();
        output.end();
        errors.end();
        inputStream.end();
        onExit(event.exitCode, event.signal ? String(event.signal) : null);
      });
      streams = { stdout: output, stderr: errors, stdin: inputStream };
    } else {
      const child = spawnChild(executable, args, {
        cwd: input.cwd,
        env,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: "pipe",
      });
      child.on("error", (error) => {
        spawnError = error;
      });
      // Finish on leader exit so cgroup cleanup can stop remaining members;
      // waiting for close could deadlock on a descendant holding a pipe open.
      child.on("exit", onExit);
      if (!child.pid) throw new Error("Could not start process");
      pid = child.pid;
      streams = { stdout: child.stdout, stderr: child.stderr, stdin: child.stdin };
    }
    let entry: RegistryEntry | undefined;
    try {
      const deadline = Date.now() + 5000;
      let current = await identity(pid, true, token);
      while (!current?.state.startsWith("T") || current.token !== token) {
        if (spawnError) throw spawnError;
        if (exit || Date.now() >= deadline)
          throw new Error("Child failed to reach the resource setup gate");
        await delay(10);
        current = await identity(pid, true, token);
      }
      if (current.group !== pid) throw new Error("Child did not create an isolated process group");
      entry = {
        pid,
        owner: options.owner,
        type: input.kind,
        command: input.command,
        args: [...(input.args ?? [])],
        labels: { ...input.labels },
        startedAt: Date.now(),
        limits,
        enforcement: process.platform === "win32" ? "rss-polling" : "rlimit-polling",
        peakMemoryBytes: current.rss,
        token,
        start: current.start,
        gated: true,
      };
      entry.cgroup = await attachCgroup(pid, token, limits, options.cgroupRoot);
      if (entry.cgroup) entry.enforcement = "cgroup-v2";
      entries.set(pid, entry);
      await save();
      running = track(entry, streams);
      await signal(entry, "SIGCONT");
      delete entry.gated;
      await save();
      monitor(running);
      if (terminalProcess) {
        const instance = terminalProcess;
        return {
          ...running.handle,
          write: (data: string) => instance.write(data),
          resize: (columns: number, rows: number) => instance.resize(columns, rows),
        };
      }
      return running.handle;
    } catch (error) {
      // This PID was created by this call. Kill only after its random token is verified.
      const current = await identity(pid, true, token);
      if (current?.token === token) {
        const failed = { pid, token, start: current.start };
        if (await owns(failed)) {
          try {
            if (process.platform === "win32") await executeCommand(taskkillCommand(pid));
            else process.kill(-pid, "SIGKILL");
          } catch {
            /* Already exited. */
          }
        }
      }
      if (entry && !running) {
        entries.delete(pid);
        await save();
      }
      if (entry?.cgroup) await cleanCgroup(entry.cgroup);
      throw error;
    }
  }

  const api: ProcessSupervisor = {
    spawn: (input) => serial(() => launch(input, false)),
    spawnPty: (input) => serial(async () => (await launch(input, true)) as PtyHandle),
    list: (filter = {}) =>
      serial(async () => {
        validateFilter(filter);
        await open();
        return [...entries.values()].filter((entry) => matches(entry, filter)).map(info);
      }),
    stop: (filter = {}) =>
      serial(async () => {
        validateFilter(filter);
        await open();
        for (const entry of [...entries.values()].filter((entry) => matches(entry, filter)))
          await stopEntry(entry);
      }),
    stopPid: (pid) =>
      serial(async () => {
        await open();
        const entry = entries.get(pid);
        if (!entry) throw new ProcessNotOwnedError(pid);
        await stopEntry(entry);
      }),
    recover: (recovery = {}) =>
      serial(async () => {
        await open();
        const result: RecoveryResult = { adopted: [], stopped: [], cleared: [] };
        for (const entry of [...entries.values()]) {
          if (active.has(entry.pid)) continue;
          if (!(await owns(entry))) {
            entries.delete(entry.pid);
            result.cleared.push(entry.pid);
            continue;
          }
          // Never trust a persisted filesystem path for cgroup I/O after a restart.
          entry.cgroup = await recoveredCgroup(entry.pid, entry.token);
          entry.enforcement = entry.cgroup
            ? "cgroup-v2"
            : process.platform === "win32"
              ? "rss-polling"
              : "rlimit-polling";
          const keep = await recovery.keep?.(info(entry));
          if (keep) {
            const running = track(entry);
            monitor(running);
            if (entry.gated) {
              await signal(entry, "SIGCONT");
              delete entry.gated;
            }
            result.adopted.push(entry.pid);
          } else {
            await stopEntry(entry);
            result.stopped.push(entry.pid);
          }
        }
        await save();
        return result;
      }),
    stopAll() {
      shutdown ??= serial(async () => {
        await open();
        closing = true;
        try {
          const errors: unknown[] = [];
          for (const entry of [...entries.values()]) {
            try {
              if (await owns(entry)) await stopEntry(entry);
              else {
                const running = active.get(entry.pid);
                if (running) await running.finish(null, null);
                else entries.delete(entry.pid);
              }
            } catch (error) {
              errors.push(error);
            }
          }
          await save();
          if (errors.length)
            throw new AggregateError(errors, "Some owned processes could not be stopped");
        } finally {
          await registry.close();
        }
      });
      return shutdown;
    },
  };
  const stopAll = api.stopAll;
  api.stopAll = () => {
    const stopping = stopAll();
    const forget = () => {
      if (sameProcess.get(registryPath)?.api === api) sameProcess.delete(registryPath);
    };
    stopping.then(forget, forget);
    return stopping;
  };
  sameProcess.set(registryPath, { owner: options.owner, api });
  return api;
}

const SUPERVISORS = Symbol.for("@warlock.js/process.supervisors");

/** Live supervisors of this process by registry path; shared by every copy of this module. */
function sameProcessSupervisors(): Map<string, { owner: string; api: ProcessSupervisor }> {
  const holder = globalThis as unknown as Record<symbol, Map<string, any> | undefined>;
  return (holder[SUPERVISORS] ??= new Map());
}
