import type {
  DevtoolsAiRollupDelta,
  DevtoolsAiRollupFilter,
  DevtoolsAiRollupRecord,
  DevtoolsAiRollupStore,
} from "../types";
import { addRollupCounters, rollupId } from "./extract";

/** Whether a record passes the filter (shared by the memory and file stores). */
export function matchesAiRollupFilter(
  record: DevtoolsAiRollupRecord,
  filter: DevtoolsAiRollupFilter,
): boolean {
  return (
    record.hour >= filter.fromHour &&
    record.hour < filter.toHour &&
    (filter.agent === undefined || record.agent === filter.agent) &&
    (filter.model === undefined || record.model === filter.model) &&
    (filter.provider === undefined || record.provider === filter.provider)
  );
}

/** Adds a delta into `rows` (creating the record when missing); shared by the memory and file stores. */
export function applyAiRollupDelta(
  rows: Map<string, DevtoolsAiRollupRecord>,
  delta: DevtoolsAiRollupDelta,
  at: number,
): void {
  const id = rollupId(delta);
  const existing = rows.get(id);

  if (existing) {
    addRollupCounters(existing, delta);
    existing.updatedAt = at;

    return;
  }

  rows.set(id, { ...structuredClone(delta), id, updatedAt: at });
}

/** An in-memory `DevtoolsAiRollupStore` for specs (and the report service's own specs). */
export function createMemoryAiRollupStore(
  options: { now?: () => number } = {},
): DevtoolsAiRollupStore {
  const now = options.now ?? Date.now;
  const rows = new Map<string, DevtoolsAiRollupRecord>();

  return {
    async verify() {
      return true;
    },
    async increment(deltas) {
      for (const delta of deltas) applyAiRollupDelta(rows, delta, now());
    },
    async list(filter) {
      return [...rows.values()]
        .filter((row) => matchesAiRollupFilter(row, filter))
        .map((row) => structuredClone(row));
    },
    async prune(beforeHour) {
      let removed = 0;

      for (const [id, row] of rows) {
        if (row.hour < beforeHour) {
          rows.delete(id);
          removed++;
        }
      }

      return removed;
    },
  };
}
