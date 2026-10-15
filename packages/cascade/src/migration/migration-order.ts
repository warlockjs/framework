import { compareCreatedAt } from "./parse-created-at";
import type { MigrationOrigin } from "./migration";

/** The minimum shape ordering needs — the runner passes full migration classes. */
type Orderable = {
  createdAt?: string;
  migrationName: string;
  order?: number;
  origin?: MigrationOrigin;
};

/**
 * Comparator for applying migrations — oldest first.
 *
 * Priority:
 *   1. package origin before app origin
 *   2. `order` override (lower = earlier, default 0)
 *   3. `createdAt` timestamp (older = earlier)
 *   4. Alphabetical by migration name (last resort)
 */
export function sortMigrations(a: Orderable, b: Orderable): number {
  const byOrigin = Number(a.origin === "app") - Number(b.origin === "app");

  if (byOrigin !== 0) {
    return byOrigin;
  }

  const byOrder = (a.order ?? 0) - (b.order ?? 0);

  if (byOrder !== 0) {
    return byOrder;
  }

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
