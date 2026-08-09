import { compareCreatedAt } from "./parse-created-at";

/** The minimum shape ordering needs — the runner passes full migration classes. */
type Orderable = {
  createdAt?: string;
  migrationName: string;
};

/**
 * Comparator for applying migrations — oldest first.
 *
 * Priority:
 *   1. `createdAt` timestamp (older = earlier)
 *   2. Alphabetical by migration name (last resort)
 */
export function sortMigrations(a: Orderable, b: Orderable): number {
  const byCreatedAt = compareCreatedAt(a.createdAt, b.createdAt);

  if (byCreatedAt !== undefined) {
    return byCreatedAt;
  }

  // Last resort: alphabetical
  return a.migrationName.localeCompare(b.migrationName);
}

/**
 * Comparator for rolling migrations back — newest first, the exact inverse of
 * {@link sortMigrations}.
 *
 * A rollback has to undo migrations in the reverse of the order they were
 * applied, or a `down()` will hit schema its predecessor already removed —
 * dropping a table before dropping the column that was added to it.
 *
 * This must be an explicit descending sort rather than a `.reverse()` of the
 * executed list: that list is read back ordered by `batch, name`, so it is
 * alphabetical rather than chronological, and reversing it merely produces
 * reverse-alphabetical order.
 */
export function sortMigrationsForRollback(a: Orderable, b: Orderable): number {
  return sortMigrations(b, a);
}
