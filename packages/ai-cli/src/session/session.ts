import { spawn } from "node:child_process";
import type {
  CliEndStatus,
  CliEvent,
  CliParsedEvent,
  CliResult,
  CliSession,
  CliStreamParser,
} from "../contracts";
import type { Invocation } from "../spawn/invocation";
import { killProcessTree } from "../spawn/process-tree";
import { EventLog } from "../stream/event-log";
import { createLineSplitter } from "../stream/line-splitter";
import { ResultAggregator } from "./aggregate";

/** stderr kept for the result (the tail). */
const STDERR_LIMIT = 64 * 1024;

export type StartSessionInput = {
  adapter: string;
  invocation: Invocation;
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  parser: CliStreamParser;
  signal?: AbortSignal;
  timeoutMs?: number;
  killGraceMs: number;
  platform: NodeJS.Platform;
  resume?: string;
  /** Runs after the process exits and before `done()` resolves (removes the run directory). */
  cleanup: () => Promise<void>;
};

/**
 * Spawn the CLI and expose it as a {@link CliSession}: stdout lines go
 * through the adapter's parser into a replayable event log, and the
 * process's end becomes the `session.ended` event and the `done()` result.
 */
export function startSession(input: StartSessionInput): CliSession {
  const startedAt = Date.now();
  const log = new EventLog<CliEvent>();
  const aggregator = new ResultAggregator(input.resume);
  const controller = new AbortController();
  let stderr = "";
  let timedOut = false;
  let cancelled = false;
  let spawnError: Error | undefined;

  const emit = (events: CliParsedEvent[]): void => {
    for (const event of events) {
      aggregator.add(event);
      log.push(event);
    }
  };

  const parse = (step: () => CliParsedEvent[]): void => {
    try {
      emit(step());
    } catch (error) {
      emit([
        {
          type: "error",
          message: `stream parser failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  };

  const child = spawn(input.invocation.file, input.invocation.args, {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: input.invocation.windowsVerbatimArguments,
    // POSIX: own process group, so cancellation reaps the whole tree.
    detached: input.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });

  let cancelPendingKill: (() => void) | undefined;

  const kill = (): void => {
    cancelPendingKill = killProcessTree(child, input.platform, input.killGraceMs);
  };

  const onAbort = (): void => {
    if (timedOut || cancelled) {
      return;
    }

    cancelled = true;
    kill();
  };

  input.signal?.addEventListener("abort", onAbort, { once: true });
  controller.signal.addEventListener("abort", onAbort, { once: true });

  if (input.signal?.aborted) {
    onAbort();
  }

  const timer =
    input.timeoutMs !== undefined && input.timeoutMs > 0
      ? setTimeout(() => {
          if (cancelled) {
            return;
          }

          timedOut = true;
          kill();
        }, input.timeoutMs)
      : undefined;

  const splitter = createLineSplitter(
    (line) => parse(() => input.parser.line(line)),
    () => emit([{ type: "error", message: "dropped an output line longer than 32 MiB" }]),
  );

  child.stdout?.on("data", (chunk: Buffer) => splitter.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
  });

  // A CLI that exits before reading its prompt closes the pipe; that EPIPE
  // must not crash the host process.
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(input.stdin ?? "");

  const done = new Promise<CliResult>((resolve) => {
    let settled = false;

    const settle = async (exitCode: number | null, signal: string | null): Promise<void> => {
      if (settled) {
        return;
      }

      settled = true;

      if (timer !== undefined) {
        clearTimeout(timer);
      }

      input.signal?.removeEventListener("abort", onAbort);
      splitter.end();
      parse(() => input.parser.end());
      aggregator.finish();

      const lateRef = input.parser.sessionRef?.();

      if (lateRef !== undefined && lateRef.length > 0) {
        aggregator.sessionRef = lateRef;
      }

      const status: CliEndStatus = cancelled
        ? "cancelled"
        : timedOut
          ? "timeout"
          : spawnError === undefined && exitCode === 0 && aggregator.fatalError === undefined
            ? "completed"
            : "failed";

      let error: string | undefined;

      if (status === "failed") {
        error =
          aggregator.fatalError ??
          (spawnError
            ? `could not start ${input.invocation.file}: ${spawnError.message}`
            : `${input.adapter} exited with ${signal ?? `code ${exitCode}`}` +
              (stderr.trim() ? `: ${stderr.trim().slice(-2000)}` : ""));

        if (aggregator.fatalError === undefined) {
          emit([{ type: "error", message: error, fatal: true }]);
        }
      } else if (status === "timeout") {
        error = `${input.adapter} timed out after ${input.timeoutMs} ms`;
      } else if (status === "cancelled") {
        error = `${input.adapter} run was cancelled`;
      }

      const durationMs = Date.now() - startedAt;

      log.push({
        type: "session.ended",
        status,
        exitCode,
        signal,
        sessionRef: aggregator.sessionRef,
        durationMs,
      });
      log.close();

      try {
        await input.cleanup();
      } catch {
        // A leftover temp directory must not turn a finished run into a failure.
      }

      resolve({
        status,
        text: aggregator.text,
        messages: [...aggregator.messages],
        usage: aggregator.usage,
        sessionRef: aggregator.sessionRef,
        exitCode,
        signal,
        error,
        stderr,
        durationMs,
      });
    };

    child.on("error", (error) => {
      // Only a failed spawn ends the session here; any other 'error' (a
      // failed kill) is followed by the real 'close'.
      if (child.pid === undefined) {
        spawnError = error;
        void settle(null, null);
      }
    });

    child.on("close", (code, signal) => {
      // Every pipe is closed: the tree is gone, so the delayed SIGKILL for
      // this process group must not fire.
      cancelPendingKill?.();
      void settle(code, signal);
    });
  });

  return {
    adapter: input.adapter,
    pid: child.pid,
    events: log,
    done: () => done,
    cancel: () => controller.abort(),
  };
}

/**
 * A session for a run whose signal was already aborted: nothing is spawned,
 * the stream is a single `session.ended`, and `done()` resolves `cancelled`.
 */
export function cancelledSession(adapter: string, resume?: string): CliSession {
  const log = new EventLog<CliEvent>();
  const error = `${adapter} run was cancelled before it started`;

  log.push({
    type: "session.ended",
    status: "cancelled",
    exitCode: null,
    signal: null,
    sessionRef: resume,
    durationMs: 0,
  });
  log.close();

  const result: CliResult = {
    status: "cancelled",
    text: "",
    messages: [],
    sessionRef: resume,
    exitCode: null,
    signal: null,
    error,
    stderr: "",
    durationMs: 0,
  };

  return {
    adapter,
    pid: undefined,
    events: log,
    done: () => Promise.resolve(result),
    cancel: () => undefined,
  };
}
