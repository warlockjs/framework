import { spawn as spawnChild } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { windowsRows, type Row } from "./platform";

/**
 * One long-lived PowerShell per supervisor answers batched process queries over
 * stdin/stdout, one JSON object per line:
 *
 *   request   {"id":1,"pids":[42,43],"all":false}
 *   response  {"id":1,"rows":[{"pid":42,"parent":4,"start":"638...","rss":1024}]}
 *   failure   {"id":1,"error":"message"}
 *
 * `all: true` returns the whole process table (needed to sum a process tree).
 * Starting PowerShell costs about a second on Windows; paying that once instead
 * of twice per observation is what keeps a busy machine responsive.
 */
export const helperScript = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
  "$reader = [Console]::In",
  "while ($null -ne ($line = $reader.ReadLine())) {",
  "  $id = 0",
  "  try {",
  "    $request = $line | ConvertFrom-Json",
  "    $id = [int]$request.id",
  "    $wanted = @($request.pids | ForEach-Object { [int]$_ })",
  "    if ($request.all) { $found = @(Get-CimInstance Win32_Process) }",
  "    elseif ($wanted.Count -eq 0) { $found = @() }",
  "    else { $found = @(Get-CimInstance Win32_Process -Filter (($wanted | ForEach-Object { 'ProcessId=' + $_ }) -join ' OR ')) }",
  "    $rows = @($found | ForEach-Object {",
  "      if ($wanted -contains [int]$_.ProcessId -and $null -eq $_.CreationDate) { throw 'Cannot read process creation time' }",
  "      if ($null -ne $_.CreationDate) {",
  "        [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; start = $_.CreationDate.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture); rss = [double]$_.WorkingSetSize }",
  "      }",
  "    })",
  "    $reply = ConvertTo-Json -InputObject @{ id = $id; rows = $rows } -Compress -Depth 4",
  "  } catch {",
  "    $reply = ConvertTo-Json -InputObject @{ id = $id; error = [string]$_.Exception.Message } -Compress",
  "  }",
  "  [Console]::Out.WriteLine($reply)",
  "  [Console]::Out.Flush()",
  "}",
].join("\n");

/** The subset of ChildProcess the helper uses; tests inject a fake. */
export type HelperChild = {
  pid?: number;
  stdin: Writable;
  stdout: Readable;
  on(event: "exit" | "error", listener: () => void): unknown;
  kill(): unknown;
  unref?(): void;
};
export type HelperSpawn = (file: string, args: string[]) => HelperChild;

export function defaultHelperSpawn(file: string, args: string[]): HelperChild {
  const child = spawnChild(file, args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  // The helper must never keep the host process alive; stopAll() closes it.
  child.unref();
  (child.stdin as unknown as { unref?(): void }).unref?.();
  (child.stdout as unknown as { unref?(): void }).unref?.();
  return child;
}

export function helperArguments(): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(helperScript, "utf16le").toString("base64"),
  ];
}

export type WindowsHelperOptions = {
  spawn?: HelperSpawn;
  /** Longest wait for one response, including PowerShell's own start-up. */
  timeoutMs?: number;
  now?: () => number;
};

type Waiter = { resolve(rows: Row[]): void; reject(error: unknown): void; pids: number[] };
type Batch = { pids: Set<number>; all: boolean; waiters: Waiter[] };
type Flight = {
  id: number;
  pids: number[];
  all: boolean;
  waiters: Waiter[];
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
};
type Snapshot = { at: number; all: boolean; pids: Set<number>; rows: Row[] };

export class WindowsProcessHelper {
  private child: HelperChild | undefined;
  private buffer = "";
  private flight: Flight | undefined;
  private batch: Batch | undefined;
  private scheduled = false;
  private nextId = 1;
  private closed = false;
  private last: Snapshot | undefined;
  /** Number of PowerShell processes started; a restart shows up here. */
  starts = 0;
  /** Number of requests written to the helper. */
  requests = 0;
  private readonly spawn: HelperSpawn;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: WindowsHelperOptions = {}) {
    this.spawn = options.spawn ?? defaultHelperSpawn;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Rows for the given PIDs, or the whole table with `all`. Calls made while a
   * request is in flight share the next request, so N concurrent observations
   * cost one query. `maxAgeMs` accepts a snapshot at most that old.
   */
  query(pids: number[], all = false, maxAgeMs = 0): Promise<Row[]> {
    if (this.closed) return Promise.reject(new Error("Windows process helper is closed"));
    const cached = this.last;
    if (
      maxAgeMs > 0 &&
      cached &&
      this.now() - cached.at <= maxAgeMs &&
      (cached.all || (!all && pids.every((pid) => cached.pids.has(pid))))
    )
      return Promise.resolve(cached.rows);
    return new Promise<Row[]>((resolve, reject) => {
      const batch = (this.batch ??= { pids: new Set(), all: false, waiters: [] });
      for (const pid of pids) batch.pids.add(pid);
      batch.all ||= all;
      batch.waiters.push({ resolve, reject, pids });
      this.schedule();
    });
  }

  /** Stops the helper; pending queries reject. Safe to call twice. */
  async close(): Promise<void> {
    this.closed = true;
    const error = new Error("Windows process helper is closed");
    this.failAll(error);
    this.discard();
  }

  private schedule(): void {
    if (this.flight || this.scheduled) return;
    this.scheduled = true;
    // Let observations started in the same tick join one request.
    setImmediate(() => {
      this.scheduled = false;
      this.dispatch();
    });
  }

  private dispatch(): void {
    if (this.flight || !this.batch) return;
    const batch = this.batch;
    this.batch = undefined;
    this.flight = {
      id: this.nextId++,
      pids: [...batch.pids],
      all: batch.all,
      waiters: batch.waiters,
      attempts: 0,
    };
    this.send(this.flight);
  }

  private send(flight: Flight): void {
    flight.attempts += 1;
    try {
      const child = this.ensure();
      this.requests += 1;
      child.stdin.write(
        JSON.stringify({ id: flight.id, pids: flight.pids, all: flight.all }) + "\n",
      );
    } catch (error) {
      this.retryOrFail(flight, error);
      return;
    }
    clearTimeout(flight.timer);
    flight.timer = setTimeout(() => {
      // A wedged helper is replaced, never trusted for the next request.
      this.discard();
      this.retryOrFail(
        flight,
        new Error(
          `Windows process helper did not answer within ${this.timeoutMs} ms; raise the observationTimeoutMs supervisor option`,
        ),
      );
    }, this.timeoutMs);
    flight.timer.unref?.();
  }

  private ensure(): HelperChild {
    if (this.child) return this.child;
    const child = this.spawn("powershell.exe", helperArguments());
    this.starts += 1;
    this.child = child;
    this.buffer = "";
    child.stdout.setEncoding?.("utf8");
    child.stdout.on("data", (chunk: string | Buffer) => {
      if (this.child !== child) return;
      this.buffer += chunk.toString();
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).replace(/^﻿/, "").trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) this.receive(line);
        newline = this.buffer.indexOf("\n");
      }
    });
    child.stdin.on("error", () => undefined);
    const died = () => {
      if (this.child !== child) return;
      this.child = undefined;
      const flight = this.flight;
      if (flight) this.retryOrFail(flight, new Error("Windows process helper exited unexpectedly"));
    };
    child.on("exit", died);
    child.on("error", died);
    return child;
  }

  private receive(line: string): void {
    const flight = this.flight;
    if (!flight) return;
    let reply: { id?: unknown; rows?: unknown; error?: unknown };
    try {
      reply = JSON.parse(line) as typeof reply;
    } catch {
      return; // Banner or stray output; only well-formed replies count.
    }
    if (reply.id !== flight.id) return;
    clearTimeout(flight.timer);
    this.flight = undefined;
    try {
      if (typeof reply.error === "string") throw new Error(reply.error);
      const rows = windowsRows(reply.rows);
      this.last = {
        at: this.now(),
        all: flight.all,
        pids: new Set(flight.pids),
        rows,
      };
      for (const waiter of flight.waiters) waiter.resolve(rows);
    } catch (error) {
      for (const waiter of flight.waiters) waiter.reject(error);
    }
    if (this.batch) this.schedule();
  }

  /** One automatic retry on a fresh helper; queries are read-only, so repeating is safe. */
  private retryOrFail(flight: Flight, error: unknown): void {
    clearTimeout(flight.timer);
    if (this.closed || flight.attempts >= 2) {
      if (this.flight === flight) this.flight = undefined;
      for (const waiter of flight.waiters) waiter.reject(error);
      if (this.batch && !this.closed) this.schedule();
      return;
    }
    this.discard();
    this.send(flight);
  }

  private failAll(error: unknown): void {
    const flight = this.flight;
    this.flight = undefined;
    clearTimeout(flight?.timer);
    const batch = this.batch;
    this.batch = undefined;
    for (const waiter of [...(flight?.waiters ?? []), ...(batch?.waiters ?? [])])
      waiter.reject(error);
  }

  private discard(): void {
    const child = this.child;
    this.child = undefined;
    this.last = undefined;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      /* Already closed. */
    }
    try {
      child.kill();
    } catch {
      /* Already gone. */
    }
  }
}

export function createWindowsHelper(options: WindowsHelperOptions = {}): WindowsProcessHelper {
  return new WindowsProcessHelper(options);
}
