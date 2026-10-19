import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { atomicWriteAsync } from "./atomic";
import {
  assertDurability,
  ensureDurableDirectory,
  syncDirectory,
  type WriteDurability,
} from "./durability";
import { hasCode } from "./transaction-lock";
import { FsTransactionError } from "./transaction-types";

export const metadataName = ".warlock-transactions";
export type Image = string | null;
export type Change = { path: string; before: Image; after: Image };
export type Journal = {
  version: 1;
  root: string;
  operationId: string;
  epoch: number;
  phase: "intent" | "committed";
  durability: WriteDurability;
  hasResult: boolean;
  result: unknown;
  changes: Change[];
};
export type Head = { epoch: number; pending: string | null };

export const digest = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex");
export const journalPath = (root: string, id: string): string =>
  path.join(root, metadataName, "journal", `${digest(JSON.stringify(id))}.json`);
export const headPath = (root: string): string => path.join(root, metadataName, "head.json");

export function invalid(message: string): never {
  throw new FsTransactionError("invalid-journal", message);
}

export function relativePath(input: string): string {
  const parts = input.replaceAll("\\", "/").split("/");
  if (
    !input ||
    Array.from(input).some((character) => character.charCodeAt(0) < 32) ||
    path.isAbsolute(input) ||
    /^[a-z]:/iu.test(input) ||
    parts.some((part) => !part || part === "." || part === ".." || /[<>:"|?*]/u.test(part)) ||
    parts[0]?.toLowerCase() === metadataName
  ) {
    throw new Error("Transaction paths must be relative files outside reserved metadata");
  }
  // Refuse Windows aliases (trailing dot/space) on every platform.
  if (
    parts.some(
      (part) => /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    )
  )
    throw new Error("Ambiguous transaction path");
  return parts.join("/");
}

/** Trusted root only: containment checks do not sandbox hostile concurrent path swaps. */
export async function checkedPath(root: string, input: string): Promise<string> {
  const relative = relativePath(input);
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Transaction paths cannot contain symbolic links");
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  return path.join(root, relative);
}

export async function optionalBytes(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

export async function canonicalRoot(root: string): Promise<string> {
  return realpath(root);
}

export async function initialize(root: string, durability: WriteDurability): Promise<void> {
  assertDurability(durability);
  for (const suffix of [metadataName, `${metadataName}/journal`, `${metadataName}/writers`]) {
    const target = path.join(root, suffix);
    try {
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink())
        invalid("Metadata must be real directories");
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    if (durability === "full") {
      await ensureDurableDirectory(target);
      // Also cover a directory just created by a concurrent initializer.
      await syncDirectory(target);
      await syncDirectory(path.dirname(target));
    } else await mkdir(target, { recursive: true });
  }
}

export async function saveJson(
  file: string,
  value: unknown,
  durability: WriteDurability,
): Promise<void> {
  await atomicWriteAsync(file, JSON.stringify(value), { durability });
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch (cause) {
    throw new FsTransactionError("invalid-journal", "Malformed transaction metadata", { cause });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function readHead(root: string): Promise<Head> {
  const raw = await optionalBytes(headPath(root));
  if (!raw) return { epoch: 0, pending: null };
  const value: unknown = parseJson(raw);
  if (
    !isObject(value) ||
    typeof value.epoch !== "number" ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 0 ||
    !(value.pending === null || typeof value.pending === "string")
  ) {
    invalid("Invalid transaction head");
  }
  return { epoch: value.epoch, pending: value.pending };
}

function isImage(value: unknown): value is Image {
  return (
    value === null ||
    (typeof value === "string" && Buffer.from(value, "base64").toString("base64") === value)
  );
}

export function parseJournal(raw: Buffer, root: string): Journal {
  const value: unknown = parseJson(raw);
  if (
    !isObject(value) ||
    value.version !== 1 ||
    value.root !== root ||
    typeof value.operationId !== "string" ||
    !value.operationId ||
    value.operationId.length > 256 ||
    typeof value.epoch !== "number" ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1 ||
    (value.phase !== "intent" && value.phase !== "committed") ||
    (value.durability !== "file" && value.durability !== "full") ||
    typeof value.hasResult !== "boolean" ||
    !Object.hasOwn(value, "result") ||
    (!value.hasResult && value.result !== null) ||
    !Array.isArray(value.changes)
  ) {
    invalid("Invalid transaction journal");
  }
  const changes: Change[] = [];
  const seen = new Set<string>();
  for (const item of value.changes) {
    if (
      !isObject(item) ||
      typeof item.path !== "string" ||
      !isImage(item.before) ||
      !isImage(item.after)
    ) {
      invalid("Invalid journal image");
    }
    if (relativePath(item.path) !== item.path || seen.has(item.path.toLowerCase())) {
      invalid("Duplicate or noncanonical journal path");
    }
    seen.add(item.path.toLowerCase());
    changes.push({ path: item.path, before: item.before, after: item.after });
  }
  return {
    version: 1,
    root,
    operationId: value.operationId,
    epoch: value.epoch,
    phase: value.phase,
    durability: value.durability,
    hasResult: value.hasResult,
    result: value.result,
    changes,
  };
}

export async function loadJournals(root: string): Promise<Journal[]> {
  let names: string[];
  try {
    names = await readdir(path.join(root, metadataName, "journal"));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }
  const records: Journal[] = [];
  for (const name of names) {
    if (name.endsWith(".tmp")) continue;
    if (!/^[a-f0-9]{64}\.json$/u.test(name)) invalid("Unknown journal entry");
    const file = path.join(root, metadataName, "journal", name);
    const record = parseJournal(await readFile(file), root);
    if (file !== journalPath(root, record.operationId))
      invalid("Journal operation identity mismatch");
    records.push(record);
  }
  records.sort((left, right) => left.epoch - right.epoch);
  records.forEach((record, index) => {
    if (record.epoch !== index + 1 || (record.phase === "intent" && index !== records.length - 1)) {
      invalid("Discontinuous transaction history");
    }
  });
  return records;
}

export async function complete(root: string, record: Journal): Promise<void> {
  assertDurability(record.durability);
  // Validate every image before touching any target; do not overwrite foreign bytes.
  for (const change of record.changes) {
    const current = await optionalBytes(await checkedPath(root, change.path));
    const image = current?.toString("base64") ?? null;
    if (image !== change.before && image !== change.after) {
      throw new FsTransactionError("recovery-conflict", `Unexpected bytes at ${change.path}`);
    }
  }
  await saveJson(
    headPath(root),
    { epoch: record.epoch - 1, pending: record.operationId },
    record.durability,
  );
  for (const change of record.changes) {
    const file = await checkedPath(root, change.path);
    if (change.after === null) {
      await unlink(file).catch((error: unknown) => {
        if (!hasCode(error, "ENOENT")) throw error;
      });
      if (record.durability === "full") {
        // A never-existing target may also have a never-existing parent.
        const parent = path.dirname(file);
        try {
          await syncDirectory(parent);
        } catch (error) {
          if (!hasCode(error, "ENOENT")) throw error;
        }
      }
    } else {
      await atomicWriteAsync(file, Buffer.from(change.after, "base64"), {
        durability: record.durability,
      });
    }
  }
  await saveJson(
    journalPath(root, record.operationId),
    { ...record, phase: "committed" },
    record.durability,
  );
  await saveJson(headPath(root), { epoch: record.epoch, pending: null }, record.durability);
}

export async function recover(root: string): Promise<Head> {
  const records = await loadJournals(root);
  const head = await readHead(root);
  const latest = records.at(-1);
  if (
    head.epoch > records.length ||
    (head.pending && head.pending !== latest?.operationId) ||
    (latest && head.epoch < latest.epoch - 1) ||
    (!latest && head.pending !== null)
  ) {
    invalid("Head does not match transaction history");
  }
  if (latest?.phase === "intent") {
    if (head.epoch !== latest.epoch - 1) invalid("Intent has an advanced head");
    // A visible intent may be a rename whose directory sync previously failed.
    await saveJson(journalPath(root, latest.operationId), latest, latest.durability);
    await complete(root, latest);
  } else if (latest && (head.pending !== null || head.epoch !== latest.epoch)) {
    // Targets precede the commit marker, but a previous marker-directory sync
    // may have failed. Reestablish that ordering before publishing a stable head.
    await saveJson(journalPath(root, latest.operationId), latest, latest.durability);
    await saveJson(headPath(root), { epoch: latest.epoch, pending: null }, latest.durability);
  }
  return { epoch: latest?.epoch ?? 0, pending: null };
}
