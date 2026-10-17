import { WorkspaceJobError, WorkspacePolicyError } from "./errors";
import type {
  ShellJobInfo,
  ShellJobStatus,
  ShellOutputOptions,
  ShellOutputResult,
  WorkspaceBackendProcess,
  WorkspaceOutputStream,
} from "./contracts";

/** Default most background commands running at once. */
export const DEFAULT_MAX_BACKGROUND_JOBS = 4;

/** Finished commands kept for a last `shell_output` read before the oldest are pruned. */
const MAX_FINISHED_JOBS = 16;

/** Longest `waitMs` a `shellOutput` call may ask for. */
export const MAX_OUTPUT_WAIT_MS = 30_000;

/** How long `kill()` / `dispose()` wait for a killed tree to report its exit. */
const KILL_SETTLE_MS = 5_000;

/** One retained piece of output. */
interface OutputChunk {
  stream: WorkspaceOutputStream;
  text: string;
  /** Cumulative byte offset of the chunk's first byte. */
  offset: number;
  bytes: number;
}

/** What {@link ShellJobs.start} needs to launch one command. */
export interface ShellJobSpec {
  /** The command line (already policy-checked). */
  command: string;
  /** Most bytes of output to keep (newest wins). */
  retainBytes: number;
  /** Most commands running at once. */
  maxJobs: number;
  /** Wall-clock cap, if any. */
  timeoutMs?: number;
  /** Start the process; output must be delivered through `onOutput`. */
  launch(onOutput: (stream: WorkspaceOutputStream, chunk: string) => void): WorkspaceBackendProcess;
}

/** Resolve after `ms`, without keeping the event loop alive. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    timer.unref?.();
  });
}

/**
 * Keep the last `maxBytes` UTF-8 bytes of `text`, cutting forward to a
 * character boundary so the kept tail never starts mid-character.
 */
function tailUtf8(text: string, maxBytes: number): { text: string; bytes: number } {
  const buffer = Buffer.from(text, "utf8");

  if (buffer.byteLength <= maxBytes) {
    return { text, bytes: buffer.byteLength };
  }

  let start = buffer.byteLength - maxBytes;

  while (start < buffer.byteLength && ((buffer[start] ?? 0) & 0xc0) === 0x80) {
    start++;
  }

  const kept = buffer.subarray(start);

  return { text: kept.toString("utf8"), bytes: kept.byteLength };
}

/** Bytes of `text` from byte `skip` on, moved forward to a character boundary. */
function skipUtf8(text: string, skip: number): string {
  const buffer = Buffer.from(text, "utf8");
  let start = Math.max(0, skip);

  while (start < buffer.byteLength && ((buffer[start] ?? 0) & 0xc0) === 0x80) {
    start++;
  }

  return buffer.subarray(start).toString("utf8");
}

/** One background command and its retained output. */
class ShellJob {
  public status: ShellJobStatus = "running";

  public exitCode: number | null = null;

  public endedAt?: string;

  public readonly startedAt = new Date().toISOString();

  /** Total bytes produced so far (both streams). */
  public produced = 0;

  /** Where the next default read starts. */
  public readCursor = 0;

  /** Retained output, oldest first. */
  private readonly chunks: OutputChunk[] = [];

  private retained = 0;

  private readonly listeners = new Set<() => void>();

  public process?: WorkspaceBackendProcess;

  public killRequested = false;

  public timedOut = false;

  public timer?: ReturnType<typeof setTimeout>;

  public constructor(
    public readonly id: string,
    public readonly command: string,
    private readonly retainBytes: number,
  ) {}

  public append(stream: WorkspaceOutputStream, chunk: string): void {
    if (chunk === "") {
      return;
    }

    const bytes = Buffer.byteLength(chunk, "utf8");

    this.chunks.push({ stream, text: chunk, offset: this.produced, bytes });
    this.produced += bytes;
    this.retained += bytes;
    this.trim();
    this.notify();
  }

  /** Drop the oldest output until at most `retainBytes` are kept. */
  private trim(): void {
    while (this.retained > this.retainBytes && this.chunks.length > 0) {
      const oldest = this.chunks[0];

      if (oldest === undefined) {
        return;
      }

      const excess = this.retained - this.retainBytes;

      if (oldest.bytes <= excess) {
        this.chunks.shift();
        this.retained -= oldest.bytes;

        continue;
      }

      const kept = tailUtf8(oldest.text, oldest.bytes - excess);

      this.retained -= oldest.bytes - kept.bytes;
      oldest.offset += oldest.bytes - kept.bytes;
      oldest.text = kept.text;
      oldest.bytes = kept.bytes;
    }
  }

  public finish(exitCode: number): void {
    if (this.status !== "running") {
      return;
    }

    this.exitCode = exitCode;
    this.status = this.timedOut ? "timed-out" : this.killRequested ? "killed" : "exited";
    this.endedAt = new Date().toISOString();

    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }

    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  /** Resolve on the next output or state change (or after `ms`, or on abort). */
  public waitForChange(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();

        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;

      const done = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }

        this.listeners.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };

      timer = setTimeout(done, ms);
      timer.unref?.();
      this.listeners.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  public info(): ShellJobInfo {
    return {
      id: this.id,
      command: this.command,
      status: this.status,
      exitCode: this.exitCode,
      ...(this.process?.pid !== undefined ? { pid: this.process.pid } : {}),
      startedAt: this.startedAt,
      ...(this.endedAt !== undefined ? { endedAt: this.endedAt } : {}),
    };
  }

  /** Output produced after byte `since`, plus how much of it is gone. */
  public read(since: number): ShellOutputResult {
    const from = Math.min(Math.max(0, Math.floor(since)), this.produced);
    const firstRetained = this.chunks[0]?.offset ?? this.produced;
    const droppedBytes = Math.max(0, firstRetained - from);
    let stdout = "";
    let stderr = "";

    for (const chunk of this.chunks) {
      const end = chunk.offset + chunk.bytes;

      if (end <= from) {
        continue;
      }

      const text = chunk.offset >= from ? chunk.text : skipUtf8(chunk.text, from - chunk.offset);

      if (chunk.stream === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
    }

    this.readCursor = this.produced;

    return {
      ...this.info(),
      stdout,
      stderr,
      cursor: this.produced,
      droppedBytes,
      truncated: droppedBytes > 0,
    };
  }
}

/**
 * The background commands one workspace owns. Shared by every projection
 * (`readonly()`, `scope()`) of the workspace, so `dispose()` on any of them
 * stops them all.
 */
export class ShellJobs {
  private readonly jobs = new Map<string, ShellJob>();

  private nextId = 1;

  private disposed = false;

  /** Whether {@link dispose} has run. */
  public get isDisposed(): boolean {
    return this.disposed;
  }

  /** Start a command as a background job. */
  public start(spec: ShellJobSpec): ShellJobInfo {
    if (this.disposed) {
      throw new WorkspacePolicyError(
        "The workspace has been disposed; it cannot start new commands.",
        { type: "denied-command", reason: "not-allowed", command: spec.command },
      );
    }

    const running = [...this.jobs.values()].filter((job) => job.status === "running").length;

    if (running >= spec.maxJobs) {
      throw new WorkspacePolicyError(
        `${running} background commands are already running (the limit is ${spec.maxJobs}). Stop one with shell_kill first.`,
        { type: "denied-command", reason: "not-allowed", command: spec.command },
      );
    }

    const job = new ShellJob(`job-${this.nextId++}`, spec.command, spec.retainBytes);

    this.jobs.set(job.id, job);

    const handle = spec.launch((stream, chunk) => job.append(stream, chunk));

    job.process = handle;

    if (spec.timeoutMs !== undefined && spec.timeoutMs > 0) {
      job.timer = setTimeout(() => {
        if (job.status === "running") {
          job.timedOut = true;
          handle.kill();
        }
      }, spec.timeoutMs);
      job.timer.unref?.();
    }

    void handle.done.then(({ exitCode }) => job.finish(exitCode));
    this.prune();

    return job.info();
  }

  /** Forget the oldest finished jobs beyond {@link MAX_FINISHED_JOBS}. */
  private prune(): void {
    const finished = [...this.jobs.values()].filter((job) => job.status !== "running");

    for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS))) {
      this.jobs.delete(job.id);
    }
  }

  private get(id: string): ShellJob {
    const job = this.jobs.get(id);

    if (job === undefined) {
      throw new WorkspaceJobError(
        `No background command with id "${id}" exists in this workspace.`,
        {
          type: "not-found",
          jobId: id,
        },
      );
    }

    return job;
  }

  /** New output of a job (see {@link ShellOutputOptions}). */
  public async output(id: string, opts?: ShellOutputOptions): Promise<ShellOutputResult> {
    const job = this.get(id);
    const since = opts?.since ?? job.readCursor;
    const waitMs = Math.min(Math.max(0, opts?.waitMs ?? 0), MAX_OUTPUT_WAIT_MS);

    if (waitMs > 0 && job.status === "running" && job.produced <= since) {
      await job.waitForChange(waitMs, opts?.signal);
    }

    return job.read(since);
  }

  /** Kill a job's process tree and wait (bounded) for it to stop. */
  public async kill(id: string): Promise<ShellJobInfo> {
    const job = this.get(id);

    await this.stop(job);

    return job.info();
  }

  private async stop(job: ShellJob): Promise<void> {
    if (job.status !== "running" || job.process === undefined) {
      return;
    }

    job.killRequested = true;
    job.process.kill();
    await Promise.race([job.process.done, delay(KILL_SETTLE_MS)]);
  }

  /** Every job, oldest first. */
  public list(): ShellJobInfo[] {
    return [...this.jobs.values()].map((job) => job.info());
  }

  /** Kill every running job and refuse new ones. Idempotent. */
  public async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.jobs.values()].map((job) => this.stop(job)));
  }
}
