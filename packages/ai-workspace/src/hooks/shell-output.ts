import type {
  WorkspaceHooks,
  WorkspaceOutputStream,
  WorkspaceShellOutputEvent,
} from "../contracts";

/** Shortest gap between two deliveries to the hook (about 20 a second). */
const MIN_INTERVAL_MS = 50;
/** A line this long without a newline is delivered anyway (minus the tail kept back). */
const MAX_PENDING_CHARS = 16_384;
/** Characters of an over-long line held back, so a secret on the cut is still whole next time. */
const HOLD_BACK_CHARS = 512;
/** Shortest `shell.env` value masked automatically. */
const MIN_SECRET_LENGTH = 8;

/** What identifies the command whose output is streamed. */
export interface ShellOutputSource {
  command: string;
  callId?: string;
  jobId?: string;
}

/**
 * Feeds a command's output to `hooks.onShellOutput`.
 *
 * Redaction needs a whole secret in one piece, and a process writes in
 * arbitrary pieces, so output is buffered to line boundaries before it is
 * redacted and delivered; the unfinished last line waits until its newline
 * arrives or the command ends (an over-long line is cut, keeping its last
 * characters back). Deliveries are merged to at most one per
 * {@link MIN_INTERVAL_MS} and the hook can never throw into the command.
 */
export class ShellOutputStreamer {
  /** Whether any output was pushed. */
  public received = false;

  private readonly pending: Record<WorkspaceOutputStream, string> = { stdout: "", stderr: "" };

  private readonly ready: Record<WorkspaceOutputStream, string> = { stdout: "", stderr: "" };

  private lastEmit = 0;

  private timer?: ReturnType<typeof setTimeout>;

  private ended = false;

  private readonly secrets: string[];

  public constructor(
    private readonly hooks: WorkspaceHooks,
    private readonly source: ShellOutputSource,
    env: Record<string, string> | undefined,
  ) {
    this.secrets = Object.values(env ?? {})
      .filter((value) => value.length >= MIN_SECRET_LENGTH)
      .sort((a, b) => b.length - a.length);
  }

  /** A streamer when the policy has `onShellOutput`, otherwise `undefined`. */
  public static create(
    hooks: WorkspaceHooks | undefined,
    source: ShellOutputSource,
    env: Record<string, string> | undefined,
  ): ShellOutputStreamer | undefined {
    return hooks?.onShellOutput === undefined
      ? undefined
      : new ShellOutputStreamer(hooks, source, env);
  }

  /** Add decoded output of one stream. */
  public push(stream: WorkspaceOutputStream, text: string): void {
    if (this.ended || text === "") {
      return;
    }

    this.received = true;

    let pending = this.pending[stream] + text;
    const newline = pending.lastIndexOf("\n");

    if (newline >= 0) {
      this.ready[stream] += pending.slice(0, newline + 1);
      pending = pending.slice(newline + 1);
    }

    if (pending.length > MAX_PENDING_CHARS) {
      this.ready[stream] += pending.slice(0, pending.length - HOLD_BACK_CHARS);
      pending = pending.slice(pending.length - HOLD_BACK_CHARS);
    }

    this.pending[stream] = pending;
    this.schedule();
  }

  /** Deliver everything left, including unfinished lines, and stop. */
  public end(): void {
    if (this.ended) {
      return;
    }

    for (const stream of ["stdout", "stderr"] as const) {
      this.ready[stream] += this.pending[stream];
      this.pending[stream] = "";
    }

    this.clearTimer();
    this.flush();
    this.ended = true;
  }

  private schedule(): void {
    if (this.timer !== undefined) {
      return;
    }

    const wait = Math.max(0, this.lastEmit + MIN_INTERVAL_MS - Date.now());

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, wait);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private flush(): void {
    this.lastEmit = Date.now();

    for (const stream of ["stdout", "stderr"] as const) {
      const text = this.ready[stream];

      if (text === "") {
        continue;
      }

      this.ready[stream] = "";
      this.deliver(stream, text);
    }
  }

  private deliver(stream: WorkspaceOutputStream, text: string): void {
    try {
      let chunk = text;

      for (const secret of this.secrets) {
        chunk = chunk.split(secret).join("[redacted]");
      }

      chunk = this.hooks.redactShellOutput?.(chunk) ?? chunk;

      if (chunk === "") {
        return;
      }

      const event: WorkspaceShellOutputEvent = {
        command: this.source.command,
        stream,
        chunk,
        ...(this.source.callId !== undefined ? { callId: this.source.callId } : {}),
        ...(this.source.jobId !== undefined ? { jobId: this.source.jobId } : {}),
      };

      this.hooks.onShellOutput?.(event);
    } catch {
      // A failing hook or redactor never touches the command; the text is dropped, not leaked.
    }
  }
}
