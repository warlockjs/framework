import type { QueryBuilderContract } from "../contracts/query-builder.contract";
import type { ChildModel, Model } from "../model/model";
/**
 * Base options shared by all database-backed validation rules.
 *
 * Identifies the model to query, the column to filter on, and an optional
 * hook to customise the query before the existence/uniqueness check runs.
 */
export type BaseQueryRuleOptions = {
    /** The Model to query against */
    Model: ChildModel<Model> | string;
    /** Callback to customise the query before it executes */
    query?: (options: {
        query: QueryBuilderContract;
        value: any;
        allValues: any;
    }) => void | Promise<void>;
    /** The column to filter by (defaults to the validated key) */
    column?: string;
};
/**
 * Base options for uniqueness validation rules.
 */
export type BaseUniqueRuleOptions = BaseQueryRuleOptions;
/**
 * Options for the `unique` validation rule.
 *
 * Accepts an optional `except` sibling-key for "unique except this other
 * input's value", or an explicit `exceptColumnName` / `exceptValue` pair
 * used by request-aware wrappers (e.g. core's `uniqueExceptCurrentUser`).
 */
export type UniqueRuleOptions = BaseUniqueRuleOptions & {
    /** Sibling input key to exclude from the uniqueness check */
    except?: string;
    /** Column name to exclude (paired with `exceptValue`) */
    exceptColumnName?: string;
    /** Value to exclude under `exceptColumnName` */
    exceptValue?: any;
};
/**
 * Options for the `exists` validation rule.
 */
export type ExistsRuleOptions = BaseQueryRuleOptions;
//# sourceMappingURL=types.d.ts.map