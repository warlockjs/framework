import { ChildModel } from "../model/model.types.mjs";
import { Model } from "../model/model.mjs";
import { QueryBuilderContract } from "../contracts/query-builder.contract.mjs";

//#region ../../@warlock.js/cascade/src/validation/types.d.ts
/**
 * Base options shared by all database-backed validation rules.
 *
 * Identifies the model to query, the column to filter on, and an optional
 * hook to customise the query before the existence/uniqueness check runs.
 */
type BaseQueryRuleOptions = {
  /** The Model to query against */Model: ChildModel<Model> | string; /** Callback to customise the query before it executes */
  query?: (options: {
    query: QueryBuilderContract;
    value: any;
    allValues: any;
  }) => void | Promise<void>; /** The column to filter by (defaults to the validated key) */
  column?: string;
};
/**
 * Base options for uniqueness validation rules.
 */
type BaseUniqueRuleOptions = BaseQueryRuleOptions;
/**
 * Options for the `unique` validation rule.
 *
 * Accepts an optional `except` sibling-key for "unique except this other
 * input's value", or an explicit `exceptColumnName` / `exceptValue` pair
 * used by request-aware wrappers (e.g. core's `uniqueExceptCurrentUser`).
 */
type UniqueRuleOptions = BaseUniqueRuleOptions & {
  /** Sibling input key to exclude from the uniqueness check */except?: string; /** Column name to exclude (paired with `exceptValue`) */
  exceptColumnName?: string; /** Value to exclude under `exceptColumnName` */
  exceptValue?: any;
};
/**
 * Options for the `exists` validation rule.
 */
type ExistsRuleOptions = BaseQueryRuleOptions;
//#endregion
export { BaseQueryRuleOptions, BaseUniqueRuleOptions, ExistsRuleOptions, UniqueRuleOptions };
//# sourceMappingURL=types.d.mts.map