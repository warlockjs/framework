import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { guardianProof } from "./guardian";
import { portableIdentity, type Command } from "./platform";

const execute = promisify(execFile);
export async function executeCommand(command: Command): Promise<string> {
  const { stdout } = await execute(command.file, command.args, {
    env: { ...process.env, ...command.env },
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}
export const TOKEN_ENV = "WARLOCK_PROCESS_TOKEN";
export type Identity = { start: string; group: number; state: string; rss: number; token?: string };

function statFields(stat: string): string[] {
  return stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
}

/**
 * A task that is exiting has already released its memory map (stat field 23,
 * vsize, reads 0) before it turns into a zombie. Linux then reports its /proc
 * files as root-owned, so it is never a live child to verify or signal.
 */
function exiting(fields: string[]): boolean {
  return ["Z", "X"].includes(fields[0] ?? "") || fields[20] === "0";
}

/** /proc fields: https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html */
export async function identity(
  pid: number,
  token = false,
  expectedToken?: string,
): Promise<Identity | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  try {
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = statFields(stat);
      const state = fields[0];
      const start = fields[19];
      if (!state || !start || exiting(fields)) return undefined;
      const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      const status = await readFile(`/proc/${pid}/status`, "utf8");
      let environment = "";
      if (token) {
        try {
          environment = await readFile(`/proc/${pid}/environ`, "utf8");
        } catch (error) {
          // Without root, the environment of a task that started exiting after
          // the first stat read is unreadable. Only that case counts as gone;
          // any other unreadable environment still fails closed.
          if ((error as { code?: unknown }).code !== "EACCES") throw error;
          const now = statFields(await readFile(`/proc/${pid}/stat`, "utf8"));
          if (now[19] !== start || exiting(now)) return undefined;
          throw error;
        }
      }
      // /proc reads are separate operations. Reject PID reuse or a group change
      // during observation before combining a token with a start identity.
      const after = statFields(await readFile(`/proc/${pid}/stat`, "utf8"));
      if (after[19] !== start || after[2] !== fields[2] || exiting(after)) return undefined;
      return {
        start: `${boot}:${start}`,
        group: Number(fields[2]),
        state: after[0] ?? state,
        rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024,
        token: environment
          .split("\0")
          .find((entry) => entry.startsWith(`${TOKEN_ENV}=`))
          ?.slice(TOKEN_ENV.length + 1),
      };
    }
    if (process.platform === "darwin" || process.platform === "win32")
      return await portableIdentity(process.platform, pid, token, executeCommand, (selected) =>
        guardianProof(selected, undefined, expectedToken),
      );
    return undefined;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (
      (process.platform === "linux" && ["ENOENT", "ESRCH"].includes(String(code))) ||
      (process.platform === "darwin" &&
        code === 1 &&
        !(error as { stdout?: string }).stdout?.trim())
    )
      return undefined;
    throw error;
  }
}

export class ProcessNotOwnedError extends Error {
  constructor(public readonly pid: number) {
    super(`Process ${pid} does not have a verified supervisor identity`);
    this.name = "ProcessNotOwnedError";
  }
}

export async function owns(entry: { pid: number; start: string; token: string }): Promise<boolean> {
  const current = await identity(entry.pid, true, entry.token);
  return (
    current?.start === entry.start && current.token === entry.token && current.group === entry.pid
  );
}
