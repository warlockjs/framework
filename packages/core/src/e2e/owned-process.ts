import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Command, ProcessEvidence } from "./types";

// A group anchor stays alive after the foreground command exits. This lets
// teardown verify a live, unique command line before BOTH TERM and KILL,
// including when the app crashed but left descendants behind.
const supervisorSource = `
import { spawn } from 'node:child_process';
process.on('SIGTERM', () => {});
process.on('SIGINT', () => {});
process.on('message', ({command}) => {
  const child = spawn(command[0], command.slice(1), {cwd:process.cwd(),env:process.env,stdio:'inherit'});
  child.once('spawn', () => process.send?.({type:'started',pid:child.pid}));
  child.once('error', error => process.send?.({type:'failure',message:error.message}));
  child.once('exit', (code,signal) => process.send?.({type:'exit',code,signal}));
});
`;

/** Small OS identity queries; every helper PID is retained as evidence too. */
function utility(command: string, args: string[], records: ProcessEvidence[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: "utf8" }, (error, stdout) => {
      if (record) record.stopped = true;
      if (error) reject(error);
      else resolve(stdout);
    });
    const record: ProcessEvidence | undefined = child.pid
      ? { role: "process-identity", pid: child.pid, command: [command, ...args], ownerFile: "" }
      : undefined;
    if (record) records.push(record);
  });
}

export function commandLineOwns(commandLine: string, ownerFile: string): boolean {
  if (commandLine.includes("\0")) return commandLine.split("\0").includes(ownerFile);
  // ps/CIM expose a rendered command line; the random owner path is unique
  // to this child, never an app name, binary name, PID search, or a port.
  return commandLine.includes(ownerFile);
}

export class OwnedProcess {
  readonly record: ProcessEvidence;
  private output = "";
  private finished?: { code: number | null; signal: string | null };
  private stopping?: Promise<void>;
  private constructor(
    private child: ChildProcess,
    record: ProcessEvidence,
    private records: ProcessEvidence[],
  ) {
    this.record = record;
    records.push(record);
    const append = (chunk: Buffer) => {
      this.output = (this.output + chunk.toString()).slice(-1_000_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("message", (message: unknown) => {
      const data = message as { type?: string; code?: number | null; signal?: string | null };
      if (data.type === "exit")
        this.finished = { code: data.code ?? null, signal: data.signal ?? null };
    });
  }

  static async start(
    role: string,
    command: Command,
    directory: string,
    env: NodeJS.ProcessEnv,
    ownerDirectory: string,
    records: ProcessEvidence[],
    onCreated?: (owned: OwnedProcess) => void,
  ): Promise<OwnedProcess> {
    const ownerFile = join(ownerDirectory, `owner-${randomUUID()}.mjs`);
    await writeFile(ownerFile, supervisorSource, { mode: 0o600 });
    // detached makes the recorded supervisor PID its process-group ID on POSIX.
    // https://nodejs.org/download/release/v22.15.0/docs/api/child_process.html#optionsdetached
    const child = spawn(process.execPath, [ownerFile], {
      cwd: directory,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    if (!child.pid) {
      await new Promise<never>((_resolve, reject) => child.once("error", reject));
      throw new Error(`Could not start ${role}`);
    }
    const owned = new OwnedProcess(
      child,
      { role, pid: child.pid, command: [...command], ownerFile },
      records,
    );
    onCreated?.(owned);
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          child.removeListener("message", message);
          child.removeListener("error", failed);
          child.removeListener("exit", exited);
        };
        const failed = (error: Error) => {
          cleanup();
          reject(error);
        };
        const exited = () => failed(new Error(`${role} supervisor exited before startup`));
        const message = (value: unknown) => {
          const data = value as { type?: string; pid?: number; message?: string };
          if (data.type === "started" && typeof data.pid === "number") {
            owned.record.childPid = data.pid;
            cleanup();
            resolve();
          }
          if (data.type === "failure") failed(new Error(`${role}: ${data.message}`));
        };
        const timer = setTimeout(
          () => failed(new Error(`${role} process startup timed out`)),
          10_000,
        );
        child.on("message", message);
        child.once("error", failed);
        child.once("exit", exited);
        child.send({ command }, (error) => {
          if (error) failed(error);
        });
      });
      return owned;
    } catch (error) {
      try {
        await owned.stop();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          `Process startup and verified cleanup failed: ${String(error)}; ${String(cleanup)}`,
        );
      }
      throw error;
    }
  }

  logs(): string {
    return this.output;
  }

  assertRunning(): void {
    if (this.finished || this.child.exitCode !== null || this.child.signalCode !== null) {
      throw new Error(
        `${this.record.role} exited: ${JSON.stringify(this.finished)}\n${this.output.slice(-8000)}`,
      );
    }
  }

  async wait(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.finished && Date.now() < deadline) {
      signal?.throwIfAborted();
      await delay(25);
    }
    if (!this.finished)
      throw new Error(
        `${this.record.role} timed out after ${timeoutMs}ms\n${this.output.slice(-8000)}`,
      );
    if (this.finished.code !== 0)
      throw new Error(
        `${this.record.role} failed: ${JSON.stringify(this.finished)}\n${this.output.slice(-8000)}`,
      );
  }

  private async verify(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null)
      throw new Error(
        `Refusing cleanup: ${this.record.role} group anchor ${this.record.pid} exited unexpectedly`,
      );
    let commandLine: string;
    if (process.platform === "linux")
      commandLine = await readFile(`/proc/${this.record.pid}/cmdline`, "utf8");
    else if (process.platform === "win32") {
      // PID is from spawn, interpolated as a number; no user text enters PowerShell.
      // https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process
      commandLine = await utility(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${this.record.pid}').CommandLine`,
        ],
        this.records,
      );
    } else
      commandLine = await utility(
        "/bin/ps",
        ["-p", String(this.record.pid), "-o", "command="],
        this.records,
      );
    if (!commandLineOwns(commandLine, this.record.ownerFile))
      throw new Error(
        `Refusing cleanup: PID ${this.record.pid} command line does not contain its recorded owner file`,
      );
  }

  stop(): Promise<void> {
    this.stopping ??= this.stopOwnedGroup().catch((error: unknown) => {
      this.stopping = undefined;
      throw error;
    });
    return this.stopping;
  }

  private async stopOwnedGroup(): Promise<void> {
    await this.verify();
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    if (process.platform === "win32") {
      // Windows has no POSIX process groups. /T targets this verified PID's tree.
      // https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill
      await utility("taskkill.exe", ["/PID", String(this.record.pid), "/T", "/F"], this.records);
    } else {
      process.kill(-this.record.pid, "SIGTERM");
      await delay(250);
      await this.verify();
      process.kill(-this.record.pid, "SIGKILL");
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Owned ${this.record.role} PID ${this.record.pid} did not exit`)),
        5000,
      );
      void exited.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.record.stopped = true;
  }
}
