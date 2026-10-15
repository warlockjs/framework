import { fork, type ChildProcess, type Serializable } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_DIAGNOSTIC_BYTES = 16_384;

/** Message a registration child sends when it fails. Shared by every result kind. */
export const REGISTRATION_ERROR_MESSAGE = "route-registration:error";

/** Message a registration child sends before it imports each module. Shared by every result kind. */
export const REGISTRATION_PROGRESS_MESSAGE = "route-registration:progress";

export type RegistrationChildProcess = Pick<
  ChildProcess,
  "send" | "kill" | "disconnect" | "on" | "stdout" | "stderr" | "connected"
>;

export type RegistrationChildForker = (
  entry: string,
  options: { cwd: string },
) => RegistrationChildProcess;

export type RegistrationChildRunOptions<TResult> = Readonly<{
  cwd: string;
  timeoutMs?: number;
  childEntry?: string;
  /**
   * Test seam. An injected fork is a protocol seam, not an installation check, so the
   * compiled child is not resolved when it is set.
   */
  forkProcess?: RegistrationChildForker;
  /** The single IPC request the child receives after it starts. */
  request: Serializable;
  /** `type` of the one message that carries the result (for example `route-registration:snapshot`). */
  resultMessageType: string;
  /** What the result is called in error messages ("snapshot", "document"). */
  resultNoun: string;
  /**
   * Validate and freeze the result message. Throw to reject the run with that error.
   */
  readResult: (message: Record<string, unknown>) => TResult;
}>;

/**
 * Run the compiled registration child in a fresh process and wait for its result.
 *
 * This is the fork / IPC / timeout / diagnostics plumbing shared by the route snapshot and
 * the OpenAPI document: the child is forked, sent one request, and must answer with exactly
 * one result message (or an error message) and exit 0. The timeout names the module the
 * child was still importing; the last 16 KiB of child stdout/stderr are attached to failures.
 */
export function runRegistrationChild<TResult>(
  options: RegistrationChildRunOptions<TResult>,
): Promise<TResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const forkProcess = options.forkProcess ?? defaultForkProcess;
  const entry =
    options.childEntry ??
    (options.forkProcess ? "<injected-route-registration-child>" : resolveCompiledChildEntry());

  return new Promise<TResult>((resolve, reject) => {
    const child = forkProcess(entry, { cwd: options.cwd });
    let settled = false;
    let received: { value: TResult } | undefined;
    let stdout = "";
    let stderr = "";
    let pendingModule: string | undefined;

    const append = (current: string, chunk: Buffer) => {
      const remaining = MAX_DIAGNOSTIC_BYTES - Buffer.byteLength(current);

      return remaining <= 0 ? current : current + chunk.toString("utf8", 0, remaining);
    };

    const finish = (error?: Error, result?: TResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (child.connected) {
        child.disconnect?.();
      }

      if (error) {
        child.kill?.();
        reject(error);
      } else {
        resolve(result as TResult);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const timeout = setTimeout(() => {
      const elapsedMs = Date.now() - startedAt;

      finish(
        new Error(
          `Route registration child timed out after ${elapsedMs}ms${pendingModule ? ` while registering ${pendingModule}` : ""}.${formatDiagnostics(stdout, stderr)}`,
        ),
      );
    }, timeoutMs);
    timeout.unref?.();

    child.on("error", (error) => {
      finish(
        new Error(
          `Could not start route registration child: ${error.message}${formatDiagnostics(stdout, stderr)}`,
        ),
      );
    });

    child.on("message", (message: unknown) => {
      if (!isChildMessage(message, options.resultMessageType)) {
        return;
      }

      if (message.type === REGISTRATION_ERROR_MESSAGE) {
        finish(
          new Error(
            `Route registration child failed: ${String(message.message)}${formatDiagnostics(stdout, stderr)}`,
          ),
        );

        return;
      }

      if (message.type === REGISTRATION_PROGRESS_MESSAGE) {
        pendingModule = String(message.module);

        return;
      }

      try {
        const result = options.readResult(message);

        if (received) {
          finish(new Error(`Route registration child sent more than one ${options.resultNoun}.`));

          return;
        }

        received = { value: result };
      } catch (error) {
        finish(error as Error);
      }
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      if (code === 0 && received) {
        finish(undefined, received.value);

        return;
      }

      finish(
        new Error(
          `Route registration child exited ${code ?? "by signal"} without a valid ${options.resultNoun}.${formatDiagnostics(stdout, stderr)}`,
        ),
      );
    });

    if (!child.send) {
      finish(new Error("Route registration child did not provide an IPC send channel."));

      return;
    }

    child.send(options.request);
  });
}

function defaultForkProcess(entry: string, options: { cwd: string }): RegistrationChildProcess {
  const forkOptions: NonNullable<Parameters<typeof fork>[2]> & { windowsHide?: boolean } = {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  };

  return fork(entry, [], forkOptions);
}

/** Resolve from Core's package root, not an assumed bundler-preserved dirname. */
function resolveCompiledChildEntry(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));

  while (directory !== path.dirname(directory)) {
    const packageJson = path.join(directory, "package.json");

    if (existsSync(packageJson)) {
      try {
        if (JSON.parse(readFileSync(packageJson, "utf8")).name === "@warlock.js/core") {
          const child = path.join(directory, "esm", "production", "route-registration-child.mjs");

          if (existsSync(child)) {
            return child;
          }

          throw new Error(
            `@warlock.js/core is missing its compiled route-registration child at ${child}. Reinstall a complete package.`,
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("route-registration child")) {
          throw error;
        }
      }
    }

    directory = path.dirname(directory);
  }

  throw new Error(
    "Could not locate @warlock.js/core package root for the route-registration child.",
  );
}

function isChildMessage(
  value: unknown,
  resultMessageType: string,
): value is Record<string, unknown> & { type: string } {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const type = (value as { type?: unknown }).type;

  return (
    type === resultMessageType ||
    type === REGISTRATION_ERROR_MESSAGE ||
    type === REGISTRATION_PROGRESS_MESSAGE
  );
}

function formatDiagnostics(stdout: string, stderr: string): string {
  if (!stdout && !stderr) {
    return "";
  }

  return `\nChild stdout:\n${stdout}\nChild stderr:\n${stderr}`;
}
