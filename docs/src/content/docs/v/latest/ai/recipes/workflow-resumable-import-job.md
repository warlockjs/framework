---
title: "Recipe — Resumable import job (snapshot + resume after a crash)"
description: A long-running multi-stage import workflow that persists a snapshot after every step with ai.snapshot, so a crashed or redeployed process can resume from where it left off instead of re-running completed work.
---

A nightly job imports a vendor catalog: **fetch** the feed, **normalize** the rows, **enrich** each product with an LLM-written description, then **upsert** into the database. Each stage is expensive — the enrich step alone makes hundreds of model calls — so if the process is killed mid-run (deploy, OOM, spot-instance reclaim) you do **not** want to start over.

`ai.workflow` writes a durable snapshot after every step when you attach a `snapshotStore`. After a crash you reconstruct the same workflow definition and call `workflow.resume(runId)`: the engine loads the last snapshot, restores `ctx.input` and `ctx.state`, and continues from the next un-run step. Completed steps never re-execute.

## Setup

```bash
yarn add @warlock.js/ai @warlock.js/seal
```

## The workflow

The job is keyed by a caller-chosen `runId` so the same logical run can be resumed by id. We use `ai.snapshot.memory()` here to keep the example self-contained; for a real job that must survive a process restart, swap in `ai.snapshot.pg()` or `ai.snapshot.redis()` (durable across processes) — the workflow code is identical.

```ts
import { ai } from "@warlock.js/ai";
import type { WorkflowSnapshot } from "@warlock.js/ai";
import { catalogApi, productsRepo, descriptionWriter } from "./catalog";

// In production: ai.snapshot.pg({ ... }) or ai.snapshot.redis({ ... }).
// Memory store is process-local and resets on restart — fine for a demo,
// useless for surviving a real crash.
const snapshotStore = ai.snapshot.memory<WorkflowSnapshot>();

type ImportInput = { vendorId: string; feedUrl: string };

function buildImportJob() {
  return ai.workflow<ImportInput>({
    name: "catalog-import",
    description: "Fetch, normalize, enrich, and upsert a vendor catalog.",
    version: "1",
    snapshotStore,
    steps: [
      ai.step({
        name: "fetch",
        run: async ctx => {
          const raw = await catalogApi.download(ctx.input.feedUrl);
          ctx.state.rawCount = raw.length;
          ctx.state.raw = raw;
        },
      }),

      ai.step({
        name: "normalize",
        run: ctx => {
          const raw = ctx.state.raw as unknown[];
          ctx.state.products = raw.map(normalizeRow);
          // Drop the bulky raw payload from state once we no longer need it —
          // it would otherwise be serialized into every later snapshot.
          ctx.state.raw = undefined;
        },
      }),

      ai.step({
        name: "enrich",
        run: async ctx => {
          const products = ctx.state.products as Product[];
          const enriched: Product[] = [];

          for (const product of products) {
            // Cheap idempotency: skip anything a prior partial run already did.
            if (product.description) {
              enriched.push(product);
              continue;
            }

            const { text } = await descriptionWriter.execute(
              `Write a 40-word product description for: ${product.title}`,
            );

            enriched.push({ ...product, description: text ?? "" });
          }

          ctx.state.products = enriched;
        },
      }),

      ai.step({
        name: "upsert",
        run: async ctx => {
          const products = ctx.state.products as Product[];
          await productsRepo.bulkUpsert(ctx.input.vendorId, products);
          ctx.state.imported = products.length;
        },
      }),
    ],
  });
}
```

## Run, crash, resume

The first run dies during `enrich`. A later invocation rebuilds the **same** workflow definition (same `name` + `version` + step shape, so the structural signature matches) and calls `resume(runId)` with the same id.

```ts
const runId = `import-${vendorId}-${dateKey}`;

// ---- First invocation (this process crashes mid-enrich) ----
async function firstAttempt() {
  const job = buildImportJob();
  const { error, report } = await job.execute(
    { vendorId, feedUrl },
    { runId },
  );

  // If the process is killed before this returns, the last snapshot on
  // `snapshotStore` already holds completed steps (`fetch`, `normalize`)
  // plus whatever `enrich` had committed.
  if (error) {
    console.error(`run ${runId} halted at status=${report.status}`);
  }
}

// ---- Later invocation (after redeploy / restart) ----
async function resumeAttempt() {
  const job = buildImportJob();

  const { data, error, report } = await job.resume(runId);

  if (error) {
    console.error(`resume of ${runId} failed:`, error.message);
    return;
  }

  console.log(
    `imported ${report.state.imported} products for ${vendorId}; ` +
      `final status=${report.status}`,
  );
}
```

What `resume(runId)` does:

1. Loads the snapshot for `runId` from the store. If there is none, it throws a `WorkflowError` — there is nothing to resume.
2. Runs a **signature drift check**: the stored structural signature must match the current definition. If you changed the step shape between the crash and the resume, it throws `WorkflowDriftError`. Pass `{ force: true }` only when you know the change is safe for in-flight snapshots.
3. Restores `ctx.input` (replayed verbatim) and `ctx.state` from the snapshot, then continues from the next un-run step — `fetch` and `normalize` do not run again.

## Handling drift on resume

If you redeploy with a changed workflow and a snapshot from the old shape is still pending, the safe default is to fail loudly:

```ts
import { WorkflowDriftError } from "@warlock.js/ai";

const job = buildImportJob();

try {
  await job.resume(runId);
} catch (error) {
  if (error instanceof WorkflowDriftError) {
    // The definition changed since this run started. Decide explicitly:
    // re-run from scratch, or force-resume if the change is snapshot-safe.
    console.warn("definition drift — restarting import from scratch");
    await job.execute({ vendorId, feedUrl }, { runId });
  } else {
    throw error;
  }
}
```

## Production notes

- **`ai.snapshot.memory()` does NOT survive a process restart** — it is a process-local `Map`. It exists for dev, tests, and single-process apps. For a real "resume after a crash" guarantee, use `ai.snapshot.pg()` or `ai.snapshot.redis()`, which persist outside the process. The workflow code does not change — only the store factory does.
- **Keep step bodies idempotent.** A step that crashes *after* its side effect but *before* the snapshot commits will re-run on resume. The `enrich` loop above guards with `if (product.description)`; the `upsert` uses `bulkUpsert` (an upsert, not an insert) so re-running it is harmless.
- **Prune bulky intermediates from `ctx.state`.** Everything in `state` is serialized into every subsequent snapshot. The `normalize` step clears `ctx.state.raw` once it's consumed so the large feed payload isn't re-persisted on each later step.
- **`ctx.context` is NOT persisted** — request-scoped values (tenant, traceId, the current user) must be supplied fresh on `resume({ context })`. Only `input` and `state` round-trip. Put durable cause in `input`, request scope in `context`.
- **Bump `version` when you intentionally change the shape** so drift detection is meaningful: a stored snapshot from `version: "1"` will trip `WorkflowDriftError` against `version: "2"`, forcing an explicit decision instead of a silent mis-resume.
- **Snapshot writes are best-effort and never abort the run** — a failed checkpoint surfaces via events/logs, but the workflow keeps going. Treat the store as a resilience aid, not a transaction boundary.
