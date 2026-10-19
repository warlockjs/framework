import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { atomicWriteAsync } from "./atomic";
import { FsTransactionError } from "./transaction-types";

export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

type Ticket = { pid: number; host: string; choosing: boolean; number: number };

async function readTicket(file: string): Promise<Ticket | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new FsTransactionError("invalid-journal", "Malformed writer ticket", { cause });
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("pid" in value) ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !("host" in value) ||
    typeof value.host !== "string" ||
    value.host !== hostname() ||
    !("choosing" in value) ||
    typeof value.choosing !== "boolean" ||
    !("number" in value) ||
    typeof value.number !== "number" ||
    !Number.isSafeInteger(value.number) ||
    value.number < 0
  ) {
    throw new FsTransactionError("invalid-journal", "Invalid or foreign-host writer ticket");
  }
  try {
    // Signal zero only probes existence; it never stops another process.
    process.kill(value.pid, 0);
  } catch (error) {
    if (hasCode(error, "ESRCH")) {
      await unlink(file).catch((failure: unknown) => {
        if (!hasCode(failure, "ENOENT")) throw failure;
      });
      return undefined;
    }
    if (!hasCode(error, "EPERM")) throw error;
  }
  return { pid: value.pid, host: value.host, choosing: value.choosing, number: value.number };
}

/**
 * Lamport bakery lock over atomically published, uniquely named tickets.
 * No lease expiry: paused writers retain ownership. Dead tickets have unique
 * names, so removing one cannot unlink a replacement owner's lock.
 * Requires coherent local directory enumeration and atomic file replacement.
 */
export async function withTransactionLock<T>(
  directory: string,
  timeoutMs: number,
  action: () => Promise<T>,
): Promise<T> {
  const id = randomUUID();
  const ownPath = path.join(directory, `${id}.json`);
  const own: Ticket = { pid: process.pid, host: hostname(), choosing: true, number: 0 };
  const deadline = Date.now() + timeoutMs;
  const names = async () => (await readdir(directory)).filter((name) => name.endsWith(".json"));
  try {
    await atomicWriteAsync(ownPath, JSON.stringify(own), { durability: "file" });
    let maximum = 0;
    for (const name of await names()) {
      const other = await readTicket(path.join(directory, name));
      maximum = Math.max(maximum, other?.number ?? 0);
    }
    if (maximum >= Number.MAX_SAFE_INTEGER) {
      throw new FsTransactionError("lock-timeout", "Writer ticket sequence exhausted");
    }
    own.number = maximum + 1;
    own.choosing = false;
    await atomicWriteAsync(ownPath, JSON.stringify(own), { durability: "file" });
    for (;;) {
      let blocked = false;
      for (const name of await names()) {
        if (name === `${id}.json`) continue;
        const other = await readTicket(path.join(directory, name));
        if (
          other &&
          (other.choosing ||
            other.number < own.number ||
            (other.number === own.number && name < `${id}.json`))
        ) {
          blocked = true;
          break;
        }
      }
      if (!blocked) return await action();
      if (Date.now() >= deadline) {
        throw new FsTransactionError("lock-timeout", "Timed out waiting for a cooperating writer");
      }
      await pause(10);
    }
  } finally {
    await unlink(ownPath).catch((error: unknown) => {
      if (!hasCode(error, "ENOENT")) throw error;
    });
  }
}
