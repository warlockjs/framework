/**
 * Bounded item iteration for the container validators (array, record).
 *
 * Kept out of the helpers barrel: internal to the validators.
 */
import type { SchemaContext, ValidationResult } from "../types";
import { resolveSealLimit } from "./limits";

/** How many items are validated at the same time */
export const ITEM_BATCH_SIZE = 64;

/**
 * Validate `count` items through `validateItem`, at most `ITEM_BATCH_SIZE` at a
 * time. `validateItem` reports each item's errors through `report` as soon as
 * it has them, so they are collected in completion order within a batch. Once
 * the `maxErrors` limit is reached no further batch starts, and the returned
 * list is cut to that limit.
 */
export async function validateItems(
  count: number,
  context: SchemaContext,
  validateItem: (
    index: number,
    report: (itemErrors: ValidationResult["errors"]) => void,
  ) => Promise<void>,
): Promise<ValidationResult["errors"]> {
  // At least one error is kept, so a failing item can never read as valid.
  const maxErrors = Math.max(1, resolveSealLimit(context, "maxErrors"));
  const errors: ValidationResult["errors"] = [];
  const report = (itemErrors: ValidationResult["errors"]) => {
    errors.push(...itemErrors);
  };

  for (let start = 0; start < count && errors.length < maxErrors; start += ITEM_BATCH_SIZE) {
    const end = Math.min(start + ITEM_BATCH_SIZE, count);
    const batch: Promise<void>[] = [];

    for (let index = start; index < end; index++) {
      batch.push(validateItem(index, report));
    }

    await Promise.all(batch);
  }

  return errors.length > maxErrors ? errors.slice(0, maxErrors) : errors;
}
