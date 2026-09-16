import type {
  AtomicUpdate,
  DriverAtomicUpdateOptions,
  UpdateOperations,
} from "../../contracts/database-driver.contract";
import { UnsupportedUpdateOperationError } from "../../errors/unsupported-update-operation.error";

/**
 * Update operators the Postgres driver can express in SQL.
 *
 * `$setOnInsert` only contributes to the INSERT half of an upsert; on a plain
 * update it is a no-op, exactly as in MongoDB.
 */
const SUPPORTED_OPERATORS: ReadonlySet<string> = new Set([
  "$set",
  "$unset",
  "$inc",
  "$dec",
  "$setOnInsert",
]);

/**
 * Reject every part of an update the Postgres driver cannot perform, so no
 * operator or option is ever silently dropped.
 *
 * @param update - The requested update
 * @param options - The requested update options
 * @returns The update, narrowed to an operator object
 * @throws UnsupportedUpdateOperationError for pipeline updates, `arrayFilters`,
 *   and any operator outside {@link SUPPORTED_OPERATORS}
 */
export function assertPostgresUpdate(
  update: AtomicUpdate,
  options?: DriverAtomicUpdateOptions,
): UpdateOperations {
  if (Array.isArray(update)) {
    throw new UnsupportedUpdateOperationError(
      "pipeline update",
      "postgres",
      "Use an operator object ($set/$unset/$inc/$dec) or a raw query.",
    );
  }

  if (options?.arrayFilters !== undefined) {
    throw new UnsupportedUpdateOperationError("arrayFilters", "postgres");
  }

  for (const operator of Object.keys(update)) {
    if (!SUPPORTED_OPERATORS.has(operator)) {
      throw new UnsupportedUpdateOperationError(
        operator,
        "postgres",
        "Supported operators: $set, $unset, $inc, $dec, $setOnInsert.",
      );
    }
  }

  return update;
}
