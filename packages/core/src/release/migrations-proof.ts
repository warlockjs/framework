import { appendLog, readManifest, writeManifest, type ReleaseContext } from "./store";
import type { MigrationProof, MigrationSnapshot } from "./types";

/**
 * What the proof needs from a database. Kept driver-agnostic: the default
 * implementation (see `cascade-migration-provider.ts`) reads the migration
 * ledger and the schema through cascade, and tests pass a plain object.
 */
export type MigrationProofProvider = {
  /** Names in the migration ledger, in execution order */
  listExecuted(): Promise<string[]>;
  /** Registered migrations that have not run, in the order they will run */
  listPending(): Promise<string[]>;
  /** Tables or collections */
  listTables(): Promise<string[]>;
  /** Index names of one table or collection */
  listIndexes(table: string): Promise<string[]>;
  /** Run the pending migrations; resolves to the names that were applied */
  runPending(): Promise<string[]>;
};

export type MigrationPlan = {
  target: string | null;
  pending: string[];
  expected: string[];
};

async function snapshot(provider: MigrationProofProvider): Promise<MigrationSnapshot> {
  const tables = [...(await provider.listTables())].sort();
  const indexes: Record<string, string[]> = {};

  for (const table of tables) {
    indexes[table] = [...(await provider.listIndexes(table))].sort();
  }

  return { executed: await provider.listExecuted(), tables, indexes };
}

function difference(left: string[], right: string[]): string[] {
  const other = new Set(right);

  return left.filter((item) => !other.has(item));
}

/** What `--prove` would do, without touching the database. */
export async function planMigrationProof(
  context: ReleaseContext,
  provider: MigrationProofProvider,
  target: string | null,
): Promise<MigrationPlan> {
  const pending = await provider.listPending();

  return { target, pending, expected: context.config.migrations.expected ?? pending };
}

/**
 * Snapshot the ledger, tables and indexes, run the pending migrations,
 * snapshot again and compare the result with the expected set.
 *
 * The proof passes when exactly the expected migrations were applied, in
 * order, the ledger grew by exactly those names, and every table listed in
 * `release.migrations.expectedTables` exists afterwards. The full before and
 * after snapshots go into the manifest, so the schema change is on record
 * with the release.
 *
 * Run it against a target that is safe to migrate (a staging copy): the
 * migrations really execute.
 *
 * @example
 * const proof = await proveMigrations(context, provider, "staging");
 */
export async function proveMigrations(
  context: ReleaseContext,
  provider: MigrationProofProvider,
  options: { target: string | null; releaseId: string },
): Promise<MigrationProof> {
  const plan = await planMigrationProof(context, provider, options.target);
  const before = await snapshot(provider);
  const problems: string[] = [];
  let applied: string[] = [];

  try {
    applied = await provider.runPending();
  } catch (error) {
    problems.push(`Running migrations failed: ${(error as Error).message}`);
  }

  const after = await snapshot(provider);
  const ledgerGrowth = difference(after.executed, before.executed);

  if (JSON.stringify(applied) !== JSON.stringify(plan.expected)) {
    problems.push(`Applied [${applied.join(", ")}] but expected [${plan.expected.join(", ")}].`);
  }

  if (JSON.stringify(ledgerGrowth) !== JSON.stringify(plan.expected)) {
    problems.push(
      `The ledger gained [${ledgerGrowth.join(", ")}] but expected [${plan.expected.join(", ")}].`,
    );
  }

  const removedFromLedger = difference(before.executed, after.executed);

  if (removedFromLedger.length > 0) {
    problems.push(`The ledger lost entries: ${removedFromLedger.join(", ")}.`);
  }

  for (const table of context.config.migrations.expectedTables ?? []) {
    if (!after.tables.includes(table)) problems.push(`Expected table "${table}" is missing.`);
  }

  const indexesChanged: MigrationProof["indexesChanged"] = {};

  for (const table of new Set([...Object.keys(before.indexes), ...Object.keys(after.indexes)])) {
    const was = before.indexes[table] ?? [];
    const now = after.indexes[table] ?? [];
    const added = difference(now, was);
    const removed = difference(was, now);

    if (added.length > 0 || removed.length > 0) indexesChanged[table] = { added, removed };
  }

  const proof: MigrationProof = {
    target: options.target,
    provedAt: context.now().toISOString(),
    passed: problems.length === 0,
    before,
    after,
    expected: plan.expected,
    applied,
    tablesAdded: difference(after.tables, before.tables),
    tablesRemoved: difference(before.tables, after.tables),
    indexesChanged,
    problems,
  };

  const manifest = await readManifest(context, options.releaseId);

  await writeManifest(context, { ...manifest, migrations: proof });
  await appendLog(context, {
    event: "migrations",
    release: options.releaseId,
    ok: proof.passed,
    detail: proof.passed ? `${applied.length} migration(s) proved` : problems[0],
  });

  return proof;
}
