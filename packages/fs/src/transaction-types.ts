import type { WriteDurability } from "./durability";

export type TransactionOptions = {
  /** Root-scoped idempotency key. A successful replay skips the callback and CAS. */
  operationId?: string;
  expectedEpoch?: number;
  /** Default full. Windows requires explicit file (no power-loss guarantee). */
  durability?: WriteDurability;
  /** Maximum wait for cooperating writers, default 5000 ms. */
  lockTimeoutMs?: number;
};

export type TransactionWriteOptions = {
  /** SHA-256 hex digest of the original bytes; null requires absence. */
  expectedHash?: string | null;
};

export interface FileTransaction {
  readonly operationId: string;
  readonly epoch: number;
  read(path: string): Promise<string | null>;
  readBuffer(path: string): Promise<Buffer | null>;
  hash(path: string): Promise<string | null>;
  write(path: string, content: string | Buffer, options?: TransactionWriteOptions): Promise<void>;
  remove(path: string, options?: TransactionWriteOptions): Promise<void>;
}

export type TransactionReadOptions = {
  /** Required for consistent reads; paths are relative to this root. */
  root?: string;
  consistent?: boolean;
  /** Total snapshot attempts, default 5 (maximum 100). */
  attempts?: number;
  retryDelayMs?: number;
};

export type TransactionInspection = {
  epoch: number;
  pending: boolean;
  operations: {
    operationId: string;
    epoch: number;
    phase: "intent" | "committed";
    paths: string[];
  }[];
};

export class FsTransactionError extends Error {
  public constructor(
    public readonly type:
      | "cas-conflict"
      | "lock-timeout"
      | "snapshot-changed"
      | "recovery-conflict"
      | "invalid-journal"
      | "durability-uncertain",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FsTransactionError";
  }
}
