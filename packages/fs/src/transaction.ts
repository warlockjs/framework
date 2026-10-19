import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { withTransactionLock, pause } from "./transaction-lock";
import {
  canonicalRoot,
  checkedPath,
  complete,
  digest,
  initialize,
  journalPath,
  loadJournals,
  metadataName,
  optionalBytes,
  parseJournal,
  readHead,
  recover,
  relativePath,
  saveJson,
  type Change,
  type Head,
  type Journal,
} from "./transaction-store";
import {
  FsTransactionError,
  type FileTransaction,
  type TransactionInspection,
  type TransactionOptions,
  type TransactionReadOptions,
  type TransactionWriteOptions,
} from "./transaction-types";

export * from "./transaction-types";
export type { WriteDurability } from "./durability";

function validateOptions(options: TransactionOptions): void {
  if (
    options.operationId !== undefined &&
    (!options.operationId || options.operationId.length > 256)
  )
    throw new Error("Invalid operationId");
  if (
    options.expectedEpoch !== undefined &&
    (!Number.isSafeInteger(options.expectedEpoch) || options.expectedEpoch < 0)
  )
    throw new Error("Invalid expectedEpoch");
  if (
    options.lockTimeoutMs !== undefined &&
    (!Number.isFinite(options.lockTimeoutMs) || options.lockTimeoutMs < 0)
  )
    throw new Error("Invalid lockTimeoutMs");
  if (
    options.durability !== undefined &&
    options.durability !== "full" &&
    options.durability !== "file"
  ) {
    throw new Error("Invalid durability");
  }
}

function jsonResult(value: unknown, ancestors = new Set<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return;
  if (
    typeof value !== "object" ||
    ancestors.has(value) ||
    (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
  ) {
    throw new Error("Transaction results must be JSON values or top-level undefined");
  }
  ancestors.add(value);
  if (Object.getOwnPropertySymbols(value).length)
    throw new Error("JSON results cannot contain symbols");
  for (const item of Array.isArray(value) ? value : Object.values(value))
    jsonResult(item, ancestors);
  ancestors.delete(value);
}

function resultOf<T>(record: Journal): T {
  return (record.hasResult ? record.result : undefined) as T;
}

async function replay<T>(root: string, id: string): Promise<{ value: T } | undefined> {
  const before = await readHead(root);
  const bytes = await optionalBytes(journalPath(root, id));
  if (!bytes) return undefined;
  const record = parseJournal(bytes, root);
  if (record.operationId !== id)
    throw new FsTransactionError("invalid-journal", "Replay identity mismatch");
  const after = await readHead(root);
  if (record.phase === "committed" && record.epoch <= before.epoch && record.epoch <= after.epoch)
    return { value: resultOf<T>(record) };
  return undefined;
}

class StagedTransaction implements FileTransaction {
  private active = true;
  private readonly originals = new Map<string, Buffer | null>();
  private readonly staged = new Map<string, Buffer | null>();

  public constructor(
    public readonly operationId: string,
    public readonly epoch: number,
    private readonly root: string,
  ) {}

  public close(): void {
    this.active = false;
  }
  private assertActive(): void {
    if (!this.active) throw new Error("Transaction callback has ended");
  }
  private async original(input: string): Promise<{ name: string; bytes: Buffer | null }> {
    this.assertActive();
    const name = relativePath(input);
    if (!this.originals.has(name)) {
      const bytes = await optionalBytes(await checkedPath(this.root, name));
      this.assertActive();
      // Concurrent calls within one callback share the first captured image.
      if (!this.originals.has(name)) this.originals.set(name, bytes);
    }
    return { name, bytes: this.originals.get(name) ?? null };
  }
  public async readBuffer(input: string): Promise<Buffer | null> {
    const { name, bytes } = await this.original(input);
    const value = this.staged.has(name) ? this.staged.get(name) : bytes;
    return value ? Buffer.from(value) : null;
  }
  public async read(input: string): Promise<string | null> {
    return (await this.readBuffer(input))?.toString("utf8") ?? null;
  }
  public async hash(input: string): Promise<string | null> {
    const bytes = await this.readBuffer(input);
    return bytes === null ? null : digest(bytes);
  }
  private async stage(
    input: string,
    content: Buffer | null,
    options: TransactionWriteOptions,
  ): Promise<void> {
    const expectedHash = options.expectedHash;
    const { name, bytes } = await this.original(input);
    this.assertActive();
    if (expectedHash !== undefined && expectedHash !== (bytes === null ? null : digest(bytes))) {
      throw new FsTransactionError("cas-conflict", `Content precondition failed: ${name}`);
    }
    this.staged.set(name, content);
  }
  public async write(
    input: string,
    content: string | Buffer,
    options: TransactionWriteOptions = {},
  ): Promise<void> {
    await this.stage(
      input,
      typeof content === "string" ? Buffer.from(content) : Buffer.from(content),
      options,
    );
  }
  public async remove(input: string, options: TransactionWriteOptions = {}): Promise<void> {
    await this.stage(input, null, options);
  }
  public async changes(): Promise<Change[]> {
    // Called only after closing the callback: no retained handle can mutate staging.
    const paths = [...this.originals.keys()];
    const folded = paths.map((name) => name.toLowerCase());
    if (
      new Set(folded).size !== paths.length ||
      folded.some((name, index) =>
        folded.some((other, otherIndex) => otherIndex !== index && other.startsWith(`${name}/`)),
      )
    ) {
      throw new Error("Transaction paths must be distinct files on all supported platforms");
    }
    for (const [name, original] of this.originals) {
      const current = await optionalBytes(await checkedPath(this.root, name));
      if ((current?.toString("base64") ?? null) !== (original?.toString("base64") ?? null)) {
        throw new FsTransactionError("cas-conflict", `File changed during callback: ${name}`);
      }
    }
    return [...this.staged].map(([name, bytes]) => ({
      path: name,
      before: this.originals.get(name)?.toString("base64") ?? null,
      after: bytes?.toString("base64") ?? null,
    }));
  }
}

/** Multi-file mutations for one trusted root and cooperating local processes. */
export async function transactionAsync<T>(
  root: string,
  callback: (tx: FileTransaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const captured = { ...options };
  validateOptions(captured);
  const canonical = await canonicalRoot(root);
  // Successful replay is entirely read-only, including skipping lock tickets.
  if (captured.operationId) {
    const recorded = await replay<T>(canonical, captured.operationId);
    if (recorded) return recorded.value;
  }
  const durability = captured.durability ?? "full";
  await initialize(canonical, durability);
  return withTransactionLock(
    path.join(canonical, metadataName, "writers"),
    captured.lockTimeoutMs ?? 5000,
    async () => {
      const head = await recover(canonical);
      const id = captured.operationId ?? randomUUID();
      const recorded = await replay<T>(canonical, id);
      if (recorded) return recorded.value;
      if (captured.expectedEpoch !== undefined && captured.expectedEpoch !== head.epoch) {
        throw new FsTransactionError("cas-conflict", "Root epoch precondition failed");
      }
      if (head.epoch >= Number.MAX_SAFE_INTEGER) throw new Error("Root epoch exhausted");
      const tx = new StagedTransaction(id, head.epoch, canonical);
      let result: T;
      try {
        result = await callback(tx);
      } finally {
        tx.close();
      }
      if (result !== undefined) jsonResult(result);
      const record: Journal = {
        version: 1,
        root: canonical,
        operationId: id,
        epoch: head.epoch + 1,
        phase: "intent",
        durability,
        hasResult: result !== undefined,
        result: result === undefined ? null : (JSON.parse(JSON.stringify(result)) as unknown),
        changes: await tx.changes(),
      };
      try {
        await saveJson(journalPath(canonical, id), record, durability);
        await complete(canonical, record);
      } catch (cause) {
        throw new FsTransactionError(
          "durability-uncertain",
          "Transaction may have a durable intent; reopen to recover",
          { cause },
        );
      }
      return resultOf<T>(record);
    },
  );
}

/** Read-only inspection. A concurrent writer may change this diagnostic view. */
export async function inspectTransactionsAsync(root: string): Promise<TransactionInspection> {
  const canonical = await canonicalRoot(root);
  const head = await readHead(canonical);
  const records = await loadJournals(canonical);
  return {
    epoch: head.epoch,
    pending:
      head.pending !== null ||
      records.some((record) => record.phase === "intent") ||
      records.length !== head.epoch,
    operations: records.map((record) => ({
      operationId: record.operationId,
      epoch: record.epoch,
      phase: record.phase,
      paths: record.changes.map((change) => change.path),
    })),
  };
}

/** Open/reopen a root, completing any saved intent before returning. */
export async function openTransactionRootAsync(
  root: string,
  options: Omit<TransactionOptions, "operationId" | "expectedEpoch"> = {},
): Promise<TransactionRoot> {
  const captured = { ...options };
  validateOptions(captured);
  const canonical = await canonicalRoot(root);
  await initialize(canonical, captured.durability ?? "full");
  await withTransactionLock(
    path.join(canonical, metadataName, "writers"),
    captured.lockTimeoutMs ?? 5000,
    () => recover(canonical),
  );
  return new TransactionRoot(canonical, captured);
}

export class TransactionRoot {
  public constructor(
    public readonly root: string,
    private readonly options: Omit<TransactionOptions, "operationId" | "expectedEpoch">,
  ) {}
  public transaction<T>(
    callback: (tx: FileTransaction) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    return transactionAsync(this.root, callback, { ...this.options, ...options });
  }
  public inspect(): Promise<TransactionInspection> {
    return inspectTransactionsAsync(this.root);
  }
  public read(input: string, options: Omit<TransactionReadOptions, "root"> = {}): Promise<string> {
    return readTransactionFileAsync(input, { ...options, root: this.root });
  }
  /** One epoch brackets the entire group, unlike several independent read calls. */
  public readMany(
    inputs: readonly string[],
    options: Omit<TransactionReadOptions, "root"> = {},
  ): Promise<string[]> {
    return readSnapshot(this.root, [...inputs], options);
  }
}

async function readSnapshot(
  root: string,
  inputs: string[],
  options: Omit<TransactionReadOptions, "root">,
): Promise<string[]> {
  const canonical = await canonicalRoot(root);
  const attempts = options.attempts ?? 5;
  const delay = options.retryDelayMs ?? 10;
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 100 ||
    !Number.isFinite(delay) ||
    delay < 0 ||
    delay > 1000
  ) {
    throw new Error("Invalid snapshot retry bounds");
  }
  const paths = await Promise.all(inputs.map((input) => checkedPath(canonical, input)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const before: Head = await readHead(canonical);
    if (!options.consistent || before.pending === null) {
      const outcome = await Promise.allSettled(paths.map((file) => readFile(file, "utf8")));
      const after = await readHead(canonical);
      if (!options.consistent || (after.pending === null && before.epoch === after.epoch)) {
        return outcome.map((item) => {
          if (item.status === "rejected") throw item.reason;
          return item.value;
        });
      }
    }
    if (attempt + 1 < attempts) await pause(delay);
  }
  throw new FsTransactionError(
    "snapshot-changed",
    "No stable transaction snapshot within the retry bound",
  );
}

/** UTF-8 read; consistent mode requires an explicit transaction root. */
export async function readTransactionFileAsync(
  input: string,
  options: TransactionReadOptions = {},
): Promise<string> {
  if (!options.root) {
    if (options.consistent) throw new Error("Consistent reads require a transaction root");
    return readFile(input, "utf8");
  }
  const [value] = await readSnapshot(options.root, [input], { ...options });
  if (value === undefined) throw new Error("Missing read result");
  return value;
}
