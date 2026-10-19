---
name: multi-file-transactions
description: "Use fs.transaction, fs.openTransactions, fs.inspectTransactions and fs.read for cooperating local multi-file writes, CAS, durable roll-forward recovery, operation-id replay and consistent snapshots."
---

# Multi-file state transactions

Use this for bounded application state on a trusted local root shared by
cooperating processes on one host and PID namespace. All writers must use
transactions; ordinary fs writes bypass the lock and epoch. The root already
exists. This is not distributed storage or a hostile-directory sandbox.

```ts
import { fs, FsTransactionError } from "@warlock.js/fs";

const root = "/srv/state";
const store = await fs.openTransactions(root); // recovers interrupted intents
const { epoch } = await store.inspect();

try {
  const result = await fs.transaction(
    root,
    async (tx) => {
      const previous = await tx.readBuffer("state.json"); // Buffer copy or null
      const expectedHash = previous === null ? null : fs.hash.buffer(previous);
      await tx.write("state.json", '{"ready":true}', { expectedHash });
      await tx.write("status.txt", "ready");
      await tx.remove("obsolete.txt");
      const hash = await tx.hash("state.json"); // staged bytes
      return { status: await tx.read("status.txt"), hash };
    },
    { operationId: "initialize-001", expectedEpoch: epoch },
  );
  console.log(result);
} catch (error) {
  if (error instanceof FsTransactionError && error.type === "cas-conflict") {
    // Refresh the original snapshot and decide whether to submit a new operation.
  } else {
    throw error;
  }
}

// Same id returns its recorded JSON result, ignores CAS, and skips the callback.
const replayed = await store.transaction(async () => ({ unused: true }), {
  operationId: "initialize-001",
});

const diagnostic = await fs.inspectTransactions(root); // read-only, no recovery
console.log(diagnostic.pending, diagnostic.operations, replayed);

const status = await fs.read("status.txt", { root, consistent: true, attempts: 5 });
const boundStatus = await store.read("status.txt", { consistent: true });
const [state, matchingStatus] = await store.readMany(["state.json", "status.txt"], {
  consistent: true,
});
console.log(status, boundStatus, state, matchingStatus);
```

- Await every tx call. Reads see staged changes; missing files return null.
  `expectedHash` always compares original bytes; null requires absence.
- Root epochs serialize CAS. Lock waits default to 5000 ms (`lockTimeoutMs`).
  Never nest/open the same root within its transaction callback.
- Results must be JSON values or top-level undefined. A key always means its
  original operation; bind it to request identity yourself. Historical replay
  does not invoke your callback or authorization logic.
- The durable journal holds full before/after file bytes and the callback result.
  After intent publication, errors mean uncertainty, not rollback. Open again
  to roll forward; recovery validates all original/replacement images, refuses
  foreign bytes and never invokes the callback. Inspection does not repair.
- Default full durability flushes file before rename and directory afterward,
  including new parent entries. Keep the existing root/ancestors durable.
  Windows must explicitly use `{ durability: "file" }` when opening a store
  or calling fs.transaction: process-termination recovery only, no OS-crash or
  power-loss guarantee. Rename retries transient locks without deleting targets.
- Consistent readers retry busy/changed epochs, at most `attempts` (1–100,
  default 5), with `retryDelayMs` (0–1000, default 10). Exhaustion throws
  `snapshot-changed`. `readMany` protects a group; separate reads may differ.
- Bakery tickets never evict live paused writers. Dead PID tickets are safely
  removed by unique filename. PID reuse/uncertain liveness may require operator
  inspection; foreign-host tickets fail closed. Do not manually clear a live lock.
- Paths must be relative, free of symlinks/Windows aliases, and outside reserved
  `.warlock-transactions`. Do not move a root or modify/delete its journal.
  History is retained without compaction. Protect it as sensitive application data.
  Replacements use mode 0600 and do not preserve inode metadata.

Flat APIs: `transactionAsync`, `openTransactionRootAsync`,
`inspectTransactionsAsync`, `readTransactionFileAsync`. The facade is preferred.
For one file without CAS or locking, use the `write-atomically` topic.
