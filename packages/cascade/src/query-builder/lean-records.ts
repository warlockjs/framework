import { UnsupportedLeanOperationError } from "../errors/unsupported-lean-operation.error";

/**
 * The builder state lean mode has to inspect before a query runs.
 */
export type LeanQueryState = {
  readonly eagerLoadRelations: ReadonlyMap<string, unknown>;
  readonly joinRelations?: ReadonlyMap<string, unknown>;
};

/**
 * Throw when a lean query also asks for eager-loaded relations.
 *
 * Called before the query executes, so nothing is fetched for a request that
 * cannot be answered.
 *
 * @throws UnsupportedLeanOperationError
 */
export function assertLeanCompatible(state: LeanQueryState): void {
  if (state.eagerLoadRelations.size > 0) {
    throw new UnsupportedLeanOperationError("with");
  }

  if (state.joinRelations && state.joinRelations.size > 0) {
    throw new UnsupportedLeanOperationError("joinWith");
  }
}

/**
 * Remove the model's `static hidden` top-level fields from lean rows, in place.
 *
 * The rows are fresh objects the driver just built, so mutating them is safe
 * and avoids a copy per row. Returns the same array.
 */
export function stripHiddenFromLeanRecords<TRecord>(
  records: TRecord[],
  modelClass?: { hidden?: string[] },
): TRecord[] {
  const hidden = modelClass?.hidden;

  if (!hidden || hidden.length === 0) {
    return records;
  }

  for (const record of records) {
    if (record === null || typeof record !== "object") {
      continue;
    }

    for (const field of hidden) {
      delete (record as Record<string, unknown>)[field];
    }
  }

  return records;
}
