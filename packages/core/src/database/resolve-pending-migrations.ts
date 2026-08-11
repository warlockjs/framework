import { listPendingMigrations, type PendingMigration } from "@warlock.js/cascade";

/**
 * Outcome of trying to compute the pending migration set.
 *
 * The "unavailable" arm exists because the two failure modes are NOT the same
 * answer: a database with nothing pending and a tree we could not read both
 * produce an empty list, and only one of them means it is safe to proceed.
 * Collapsing them into `[]` is how a pre-flight check reports a confident
 * all-clear over an unknown.
 */
export type PendingMigrationsResult =
  | {
      readonly type: "resolved";
      readonly migrations: PendingMigration[];
    }
  | {
      readonly type: "unavailable";
      readonly reason: string;
    };

/**
 * Load the project's migrations, then compute which of them have not run yet.
 *
 * `loadMigrations` must be the SAME registration path a real `warlock migrate`
 * takes. Skipping it does not fail — it silently yields an empty pending set,
 * because the pending set is computed from the runner's registry.
 *
 * Loading executes project code (a migration file is imported, and a broken one
 * throws), so every failure is converted into an `unavailable` result rather
 * than propagating. Callers decide what an unknown means for them: a listing
 * prints it and carries on, a gate refuses to pass.
 *
 * @example
 * const result = await resolvePendingMigrations(loadAllMigrations);
 *
 * if (result.type === "unavailable") {
 *   console.error(`Pending: unavailable — ${result.reason}`);
 * }
 */
export async function resolvePendingMigrations(
  loadMigrations: () => Promise<void>,
): Promise<PendingMigrationsResult> {
  try {
    await loadMigrations();

    const migrations = await listPendingMigrations();

    return { type: "resolved", migrations };
  } catch (error) {
    return { type: "unavailable", reason: describeFailure(error) };
  }
}

/**
 * Reduce a thrown value to a single line an operator can act on. The message is
 * the actionable part — a stack trace in the middle of a listing buries the
 * executed section the reader still needs.
 */
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
