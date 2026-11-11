import type { TransactionOptions } from "mongodb";
import type { LikePatternLimits } from "../../utils/like-pattern-limits";

/**
 * MongoDB pipeline stage names.
 */
export type PipelineStage =
  | "$match"
  | "$project"
  | "$sort"
  | "$group"
  | "$lookup"
  | "$limit"
  | "$skip"
  | "$unwind"
  | "$addFields"
  | "$setWindowFields"
  | "$vectorSearch"
  /**
   * Not a MongoDB stage: the raw escape hatches. `joinRaw()` records
   * caller-built stages emitted verbatim; `raw()` records a callback that
   * receives (and may replace) the pipeline built so far. Never mergeable.
   */
  | "$raw";

/**
 * Represents a single operation in the query builder chain.
 */
export type Operation = {
  /** The MongoDB aggregation stage this operation belongs to */
  stage: PipelineStage;
  /** Whether this operation can be merged with other operations of the same stage */
  mergeable: boolean;
  /** The operation type (for processing logic) */
  type: string;
  /** The operation data */
  data: any;
};

/**
 * MongoDB driver-specific options.
 *
 * These are cascade-next specific configurations for the MongoDB driver,
 * not native MongoDB client options.
 */
export type MongoDriverOptions = {
  /**
   * Enable auto-generation of numeric IDs.
   * When enabled, creates a counter collection for managing sequential IDs.
   * @default false
   */
  autoGenerateId?: boolean;

  /**
   * Counter collection name for auto-generated IDs.
   * @default "counters"
   */
  counterCollection?: string;

  /**
   * Transaction options for this driver.
   * Applied to all transactions unless overridden.
   */
  transactionOptions?: TransactionOptions;

  /**
   * Caps on string `whereLike` / `whereNotLike` patterns (and the `like` /
   * `notLike` where operators). MongoDB runs a LIKE pattern as a regex, and
   * each `%` wildcard multiplies how long one value can take to match, so a
   * pattern over a cap is refused with an `UnsafeFilterError`.
   *
   * - `maxWildcards` — most `%` wildcards per pattern (a run `%%` counts once).
   *   Default `2`: `%term%`, `prefix%` and `%suffix` all fit.
   * - `maxLength` — longest pattern in characters. Default `256`.
   *
   * An explicit `RegExp` argument is developer-authored and not capped.
   *
   * @example
   * ```typescript
   * driverOptions: { like: { maxWildcards: 3 } }
   * ```
   */
  like?: LikePatternLimits;
};
