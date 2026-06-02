import { Operation } from "./types.mjs";
import { MongoQueryBuilder } from "./mongodb-query-builder.mjs";
import { Collection } from "mongodb";

//#region ../../@warlock.js/cascade/src/drivers/mongodb/mongodb-query-parser.d.ts
/**
 * Options for configuring the MongoDB query parser.
 */
type MongoQueryParserOptions = {
  /** The MongoDB collection being queried */collection: Collection; /** The ordered list of operations to parse */
  operations: Operation[]; /** Factory method for creating sub-builders (used for callbacks) */
  createSubBuilder: () => MongoQueryBuilder;
};
/**
 * Parses query builder operations into MongoDB aggregation pipeline.
 *
 * This parser is responsible for converting the abstract operations collected
 * by the query builder into a concrete MongoDB aggregation pipeline. It handles
 * intelligent grouping of mergeable operations (like multiple where clauses)
 * into single pipeline stages for optimal performance.
 */
declare class MongoQueryParser {
  /**
   * The MongoDB collection being queried.
   */
  private readonly collection;
  /**
   * The ordered list of operations to parse.
   */
  private readonly operations;
  /**
   * Factory for creating sub-builders (used when resolving callbacks).
   */
  private readonly createSubBuilder;
  /**
   * Track group field names for automatic _id renaming.
   * Maps pipeline index to field names.
   */
  private readonly groupFieldNames;
  /**
   * Create a new MongoDB query parser.
   *
   * @param options - Configuration options for the parser
   */
  constructor(options: MongoQueryParserOptions);
  /**
   * Parse the operations into a MongoDB aggregation pipeline.
   *
   * This method intelligently groups mergeable operations (e.g., multiple where
   * clauses) into single pipeline stages while maintaining the correct execution
   * order for non-mergeable operations.
   *
   * @returns The MongoDB aggregation pipeline
   *
   * @example
   * ```typescript
   * const parser = new MongoQueryParser({ collection, operations });
   * const pipeline = parser.parse();
   * // [
   * //   { $match: { status: 'active', age: { $gt: 18 } } },
   * //   { $sort: { createdAt: -1 } },
   * //   { $limit: 10 }
   * // ]
   * ```
   */
  parse(): any[];
  /**
   * Track field names for group stages that need _id renaming.
   */
  private trackGroupFieldNames;
  /**
   * Post-process pipeline to rename _id fields after $group stages.
   *
   * This automatically renames MongoDB's `_id` field to the actual field name(s)
   * used for grouping, making the results more intuitive.
   *
   * @param pipeline - The aggregation pipeline
   * @returns The processed pipeline
   */
  private postProcessGroupStages;
  /**
   * Convert the parsed pipeline to a pretty-printed string for debugging.
   *
   * This method formats the MongoDB aggregation pipeline in a human-readable
   * way, making it easier to understand and debug complex queries.
   *
   * @returns A formatted string representation of the pipeline
   *
   * @example
   * ```typescript
   * const parser = new MongoQueryParser({ collection, operations });
   * console.log(parser.toPrettyString());
   * // Output:
   * // MongoDB Aggregation Pipeline:
   * // ════════════════════════════
   * // Stage 1: $match
   * //   status: "active"
   * //   age: { $gt: 18 }
   * //
   * // Stage 2: $sort
   * //   createdAt: -1
   * ```
   */
  toPrettyString(): string;
  /**
   * Format stage data with proper indentation.
   *
   * @param data - The stage data to format
   * @param indent - The indentation level
   * @returns Formatted string
   */
  private formatStageData;
  /**
   * Build a single pipeline stage from a group of operations.
   *
   * @param stage - The pipeline stage type
   * @param operations - The operations to build the stage from
   * @returns The built pipeline stage or null if no stage should be added
   */
  private buildStage;
  /**
   * Build a $match stage from where operations.
   *
   * Query building strategy:
   * - Top-level where() + orWhere() = Pure OR
   * - Use callbacks for AND + OR grouping
   *
   * @param operations - The where operations
   * @returns The $match stage or null
   */
  private buildMatchStage;
  private isPureOrCondition;
  /**
   * Build a condition from a callback-based where clause.
   * Creates a sub-builder, executes the callback, and extracts the conditions.
   * If callback has orWhere, all conditions become OR.
   *
   * @param callback - The callback function
   * @returns The built condition or null
   */
  private buildCallbackCondition;
  /**
   * Build a MongoDB filter condition from a where operation.
   *
   * @param op - The operation to build
   * @returns The MongoDB filter condition
   */
  private buildWhereCondition;
  /**
   * Build a condition based on the operator.
   *
   * @param field - The field name
   * @param operator - The comparison operator
   * @param value - The value to compare
   * @returns The MongoDB filter condition
   */
  private buildOperatorCondition;
  /**
   * Get MongoDB operator from comparison operator.
   *
   * @param operator - The comparison operator
   * @returns The MongoDB operator
   */
  private getMongoOperator;
  private resolveRawExpression;
  private bindRawString;
  private buildColumnComparison;
  private buildBetweenColumnsCondition;
  private wrapColumn;
  private buildDateEqualityCondition;
  private buildDateBeforeCondition;
  private buildDateAfterCondition;
  private buildTimeCondition;
  private buildDatePartCondition;
  private buildJsonContainsCondition;
  private buildJsonDoesntContainCondition;
  private buildJsonContainsKeyCondition;
  private buildJsonLengthCondition;
  private buildJsonTypeCondition;
  private buildArrayLengthCondition;
  private normalizeDateInput;
  private startOfDay;
  private endOfDay;
  private normalizePath;
  private applyProjectionFields;
  /**
   * Apply projection object with aliases and inclusion/exclusion.
   * @param projection - The projection object to modify
   * @param projectionObj - The projection specification
   */
  private applyProjectionObject;
  private applyRawProjection;
  private resolveProjectionExpression;
  private normalizeFieldReference;
  private buildAggregateProjection;
  private buildExistsProjection;
  private buildArraySizeExpression;
  private buildCaseExpression;
  private buildCondExpression;
  /**
   * Resolve a value as a literal (if it's a plain string) or as an expression.
   * Used for `then`/`default` values in CASE/WHEN expressions.
   */
  private resolveLiteralOrExpression;
  private inferJsonAlias;
  private buildConcatExpression;
  private buildCoalesceExpression;
  /**
   * Build a $project stage from select operations.
   *
   * @param operations - The select operations
   * @returns The $project stage or null
   */
  private buildProjectStage;
  /**
   * Build a $sort stage from order operations.
   *
   * @param operations - The order operations
   * @returns The $sort stage or null
   */
  private buildSortStage;
  /**
   * Build a $group stage from group operations.
   *
   * @param operations - The group operations
   * @returns The $group stage or null
   */
  private buildGroupStage;
  private buildGroupByStage;
  /**
   * Build a $group stage with aggregates from group operations.
   *
   * @param fields - Fields to group by
   * @param aggregates - Aggregate operations (abstract or raw)
   * @returns The $group stage or null
   */
  private buildGroupByWithAggregatesStage;
  /**
   * Extract field names from GroupByInput for renaming _id.
   *
   * @param fields - The grouping fields
   * @returns Field name(s) to use for renaming _id
   */
  private extractGroupFieldNames;
  /**
   * Translate an abstract aggregate expression to MongoDB format.
   *
   * @param expr - Abstract aggregate expression
   * @returns MongoDB aggregation expression
   */
  private translateAggregateExpression;
  private buildGroupId;
  /**
   * Build a $lookup stage from join operations.
   *
   * @param operations - The join operations
   * @returns The $lookup stage or null
   */
  private buildLookupStage;
}
//#endregion
export { MongoQueryParser };
//# sourceMappingURL=mongodb-query-parser.d.mts.map