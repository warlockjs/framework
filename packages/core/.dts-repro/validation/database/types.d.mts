import { BaseQueryRuleOptions, BaseUniqueRuleOptions } from "@warlock.js/cascade";

//#region ../../@warlock.js/core/src/validation/database/types.d.ts
/**
 * Options for unique except current user rule
 */
type UniqueExceptCurrentUserRuleOptions = BaseUniqueRuleOptions & {
  /** Column for current user filter (default: id) */exceptCurrentUserColumn?: string; /** Value field from current user model (default: id) */
  exceptCurrentUserValue?: string;
};
/**
 * Options for unique except current id rule
 */
type UniqueExceptCurrentIdRuleOptions = BaseUniqueRuleOptions & {
  /** Column for current id filter (default: id) */exceptCurrentIdColumn?: string;
};
/**
 * Options for exists except current user rule
 */
type ExistsExceptCurrentUserRuleOptions = BaseQueryRuleOptions & {
  /** Column for current user filter (default: id) */exceptCurrentUserColumn?: string; /** Value field from current user model (default: id) */
  exceptCurrentUserValue?: string;
};
/**
 * Options for exists except current id rule
 */
type ExistsExceptCurrentIdRuleOptions = BaseQueryRuleOptions & {
  /** Column for current id filter (default: id) */exceptCurrentIdColumn?: string;
};
//#endregion
export { ExistsExceptCurrentIdRuleOptions, ExistsExceptCurrentUserRuleOptions, UniqueExceptCurrentIdRuleOptions, UniqueExceptCurrentUserRuleOptions };
//# sourceMappingURL=types.d.mts.map